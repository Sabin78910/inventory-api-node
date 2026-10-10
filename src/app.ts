import { createHash, timingSafeEqual } from "node:crypto";
import { STATUS_CODES } from "node:http";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z } from "zod";
import openapi from "./openapi.json" with { type: "json" };

const ProductInput = z.object({
  name: z.string().trim().min(1).max(100),
  sku: z.string().trim().min(1).max(40),
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
  reorderLevel: z.number().int().nonnegative().optional(),
  category: z.string().trim().min(1).max(50).optional(),
});
const ProductPatch = ProductInput.pick({
  name: true,
  price: true,
  reorderLevel: true,
  category: true,
})
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });
const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["price", "name"]).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
});
const StockChange = z.object({ delta: z.number().int() });
const MovementInput = z.object({
  type: z.enum(["in", "out", "adjust"]),
  quantity: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(100).optional(),
});

// RFC 9457 problem details; `error` is kept for backwards compatibility
function problem(
  res: Response,
  status: number,
  detail: string,
  extra: { error?: unknown; errors?: unknown } = {},
) {
  res
    .status(status)
    .type("application/problem+json")
    .json({
      type: "about:blank",
      title: STATUS_CODES[status] ?? "Error",
      status,
      detail,
      error: detail,
      ...extra,
    });
}
const invalid = (res: Response, err: z.ZodError) => {
  const flat = err.flatten();
  problem(res, 400, "Request validation failed", {
    error: flat,
    errors: flat.fieldErrors,
  });
};

const BATCH_MAX = 100;
const BatchItem = z.object({
  id: z.number().int(),
  delta: z.number().int(),
  reason: z.string().trim().min(1).max(200).optional(),
});
const BatchInput = z.object({ items: z.array(BatchItem).min(1) });

const CSV_HEADER = ["name", "sku", "price", "quantity", "reorderLevel", "category"];
const csvCell = (v: string | number | undefined) => {
  let s = v === undefined ? "" : String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const ENDPOINTS = [
  ["GET /products", "curl /products?limit=10&q=widget"],
  [
    "POST /products",
    `curl -X POST /products -H 'content-type: application/json' -d '{"name":"Widget","sku":"W-1","price":2.5,"quantity":4}'`,
  ],
  [
    "PATCH /products/:id/stock",
    `curl -X PATCH /products/1/stock -H 'content-type: application/json' -d '{"delta":-1}'`,
  ],
  ["GET /alerts/low-stock", "curl /alerts/low-stock"],
  ["GET /summary", "curl /summary"],
  ["GET /products.csv", "curl /products.csv"],
] as const;

const landingPage = (s: {
  productCount: number;
  totalUnits: number;
  totalValue: number;
}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inventory API</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;color:#e5e7eb;background:#0b1020}
.hero{padding:72px 24px;text-align:center;background:linear-gradient(135deg,#0f172a,#312e81 55%,#7c3aed)}
h1{margin:0 0 12px;font-size:clamp(2rem,6vw,3.5rem);font-weight:800;color:#fff}
.hero p{margin:0 auto;max-width:560px;color:#c7d2fe}
.stats{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:32px}
.stat{min-width:140px;padding:16px 20px;border-radius:12px;background:rgba(255,255,255,.1)}
.stat b{display:block;font-size:1.75rem;color:#fff}
.links{margin-top:28px}
.links a{display:inline-block;margin:4px;padding:10px 18px;border-radius:999px;background:#fff;color:#312e81;font-weight:600;text-decoration:none}
main{max-width:960px;margin:0 auto;padding:48px 24px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.card{padding:20px;border-radius:12px;background:#151b30;border:1px solid #2a3152}
.card h2{margin:0 0 10px;font-size:1rem;color:#a5b4fc}
code{display:block;white-space:pre-wrap;word-break:break-all;font-size:.8rem;color:#d1d5db}
</style></head><body>
<section class="hero">
<h1>Inventory API</h1>
<p>Products, stock movements, low-stock alerts and CSV import/export over a simple REST interface.</p>
<div class="stats">
<div class="stat"><b data-stat="products">${s.productCount}</b>products</div>
<div class="stat"><b data-stat="units">${s.totalUnits}</b>units in stock</div>
<div class="stat"><b data-stat="value">${s.totalValue.toFixed(2)}</b>total value</div>
</div>
<div class="links">
<a href="/openapi.json">OpenAPI spec</a>
<a href="https://editor.swagger.io/?url=/openapi.json">Open in viewer</a>
</div>
</section>
<main>
${ENDPOINTS.map(([title, example]) => `<div class="card"><h2>${title}</h2><code>${example.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></div>`).join("\n")}
</main>
</body></html>`;

export interface Movement {
  id: number;
  productId: number;
  type: "in" | "out" | "adjust";
  delta: number;
  balance: number;
  reason: string;
  reference?: string;
  at: number;
}

export interface Product extends z.infer<typeof ProductInput> {
  id: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface AppOptions {
  rateLimit?: { max: number; windowMs: number };
  log?: (line: string) => void;
  now?: () => number;
  defaultReorderLevel?: number;
  apiKey?: string;
  allowedOrigins?: string[];
}

export function createApp(opts: AppOptions = {}) {
  const { max, windowMs } = opts.rateLimit ?? { max: 100, windowMs: 60_000 };
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? Date.now;
  const defaultLevel = opts.defaultReorderLevel ?? 10;
  const apiKey = opts.apiKey ?? process.env.API_KEY;
  const allowedOrigins =
    opts.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ?? "https://sabin78910.github.io")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const hits = new Map<string, { count: number; resetAt: number }>();
  const products = new Map<number, Product>();
  const movements = new Map<number, Movement[]>();
  const versions = new Map<number, number>();
  let nextId = 1;
  let nextMovementId = 1;
  const etagFor = (p: Product) => `"${p.id}-${versions.get(p.id) ?? 0}"`;
  const bump = (p: Product) =>
    versions.set(p.id, (versions.get(p.id) ?? 0) + 1);
  // optional If-Match precondition; sends 412 and returns false on mismatch
  const preconditionOk = (req: Request, res: Response, p: Product) => {
    const header = req.header("if-match");
    if (header === undefined) return true;
    const tags = header.split(",").map((t) => t.trim());
    if (tags.includes("*") || tags.includes(etagFor(p))) return true;
    problem(res, 412, "Precondition failed: stale If-Match");
    return false;
  };
  const record = (
    p: Product,
    type: Movement["type"],
    delta: number,
    reason: string,
    reference?: string,
  ) => {
    p.quantity += delta;
    bump(p);
    const m: Movement = {
      id: nextMovementId++,
      productId: p.id,
      type,
      delta,
      balance: p.quantity,
      reason,
      ...(reference ? { reference } : {}),
      at: now(),
    };
    const list = movements.get(p.id) ?? [];
    list.push(m);
    movements.set(p.id, list);
    return m;
  };
  const app = express();
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log(
        JSON.stringify({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(ms * 100) / 100,
        }),
      );
    });
    next();
  });
  app.use((req, res, next) => {
    const t = now();
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
      for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - t) / 1000));
      problem(res, 429, "Too many requests");
      return;
    }
    next();
  });
  app.use(helmet());
  // CORS for read-only methods only; writes are never opened cross-origin
  app.use((req, res, next) => {
    const origin = req.header("origin");
    const preflightMethod = req.header("access-control-request-method");
    const readOnly =
      ["GET", "HEAD"].includes(req.method) ||
      (req.method === "OPTIONS" &&
        (!preflightMethod || ["GET", "HEAD"].includes(preflightMethod)));
    if (origin && readOnly && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          req.header("access-control-request-headers") ?? "",
        );
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.status(204).end();
        return;
      }
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
    next();
  });
  app.use((req, res, next) => {
    if (!apiKey || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    const given = req.header("x-api-key");
    // hash both sides so the compare is constant-time regardless of length
    if (given && timingSafeEqual(digest(given), digest(apiKey))) {
      next();
      return;
    }
    problem(res, 401, "Unauthorized");
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(express.text({ type: "text/csv", limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });

  const summary = () => {
    let totalUnits = 0;
    let totalValue = 0;
    for (const p of products.values()) {
      totalUnits += p.quantity;
      totalValue += p.quantity * p.price;
    }
    return { productCount: products.size, totalUnits, totalValue };
  };

  app.get("/", (_req, res) => {
    res.type("html").send(landingPage(summary()));
  });

  app.get("/summary", (_req, res) => {
    res.json(summary());
  });

  app.get("/alerts/low-stock", (_req, res) => {
    const alerts = [];
    for (const p of products.values()) {
      const reorderLevel = p.reorderLevel ?? defaultLevel;
      if (p.quantity > reorderLevel) continue;
      alerts.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        quantity: p.quantity,
        reorderLevel,
        // restock to twice the reorder level
        suggestedReorderQuantity: Math.max(1, reorderLevel * 2 - p.quantity),
      });
    }
    res.json(alerts);
  });

  app.get("/products", (req, res) => {
    const low = req.query.lowStock ? Number(req.query.lowStock) : null;
    const page = PageQuery.safeParse(req.query);
    if (!page.success) {
      invalid(res, page.error);
      return;
    }
    const { limit, offset, sort, order, q, category } = page.data;
    const cat = category?.toLowerCase();
    const needle = q?.toLowerCase();
    const all = [...products.values()].filter(
      (p) =>
        (!cat || p.category?.toLowerCase() === cat) &&
        (!needle ||
          p.name.toLowerCase().includes(needle) ||
          p.sku.toLowerCase().includes(needle)),
    );
    const list =
      low === null || Number.isNaN(low)
        ? [...all]
        : all.filter((p) => p.quantity <= low);
    if (sort) {
      const dir = order === "desc" ? -1 : 1;
      list.sort(
        (a, b) =>
          dir *
          (sort === "price" ? a.price - b.price : a.name.localeCompare(b.name)),
      );
    }
    res.json({
      items: list.slice(offset, offset + limit),
      total: list.length,
      limit,
      offset,
    });
  });

  app.get("/products.csv", (_req, res) => {
    const lines = [CSV_HEADER.join(",")];
    for (const p of products.values()) {
      lines.push(
        [p.name, p.sku, p.price, p.quantity, p.reorderLevel, p.category]
          .map(csvCell)
          .join(","),
      );
    }
    res.type("text/csv").send(lines.join("\r\n") + "\r\n");
  });

  app.post("/products/import", (req, res) => {
    if (typeof req.body !== "string" || !req.body.trim()) {
      problem(res, 400, "Expected a non-empty text/csv body");
      return;
    }
    const [header, ...data] = parseCsv(req.body);
    const cols = header?.map((h) => h.trim());
    if (!cols || !CSV_HEADER.slice(0, 4).every((h) => cols.includes(h))) {
      problem(
        res,
        400,
        `Header must include: ${CSV_HEADER.slice(0, 4).join(", ")}`,
      );
      return;
    }
    const skus = new Set([...products.values()].map((p) => p.sku));
    const rows: { row: number; ok: boolean; errors?: string[] }[] = [];
    data.forEach((cells, i) => {
      const row = i + 2;
      const get = (k: string) => cells[cols.indexOf(k)]?.trim() ?? "";
      const rl = get("reorderLevel");
      const category = get("category");
      const parsed = ProductInput.safeParse({
        name: get("name"),
        sku: get("sku"),
        price: get("price") === "" ? NaN : Number(get("price")),
        quantity: get("quantity") === "" ? NaN : Number(get("quantity")),
        ...(rl === "" ? {} : { reorderLevel: Number(rl) }),
        ...(category === "" ? {} : { category }),
      });
      if (!parsed.success) {
        rows.push({
          row,
          ok: false,
          errors: parsed.error.issues.map(
            (e) => `${e.path.join(".")}: ${e.message}`,
          ),
        });
        return;
      }
      if (skus.has(parsed.data.sku)) {
        rows.push({ row, ok: false, errors: ["SKU already exists"] });
        return;
      }
      skus.add(parsed.data.sku);
      const product = { id: nextId++, ...parsed.data };
      products.set(product.id, product);
      rows.push({ row, ok: true });
    });
    const imported = rows.filter((r) => r.ok).length;
    res.json({ imported, failed: rows.length - imported, rows });
  });

  app.get("/products/:id", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      problem(res, 404, "Not found");
      return;
    }
    res.setHeader("ETag", etagFor(p));
    res.json(p);
  });

  const idempotency = new Map<
    string,
    {
      fp: string;
      at: number;
      status: number;
      headers: Record<string, string>;
      body: unknown;
    }
  >();

  app.post("/products", (req, res, next) => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      next();
      return;
    }
    const t = now();
    for (const [k, v] of idempotency) {
      if (t - v.at >= IDEMPOTENCY_TTL_MS) idempotency.delete(k);
    }
    const fp = JSON.stringify(req.body ?? null);
    const hit = idempotency.get(key);
    if (hit) {
      if (hit.fp !== fp) {
        problem(
          res,
          422,
          "Idempotency-Key was already used with a different request body",
        );
        return;
      }
      for (const [h, v] of Object.entries(hit.headers)) res.setHeader(h, v);
      res.setHeader("Idempotent-Replayed", "true");
      res.status(hit.status).json(hit.body);
      return;
    }
    const json = res.json.bind(res);
    res.json = (b: unknown) => {
      const etag = res.getHeader("ETag");
      idempotency.set(key, {
        fp,
        at: t,
        status: res.statusCode,
        headers: etag ? { ETag: String(etag) } : {},
        body: b,
      });
      return json(b);
    };
    next();
  });

  app.post("/products", (req, res) => {
    const parsed = ProductInput.safeParse(req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    if ([...products.values()].some((p) => p.sku === parsed.data.sku)) {
      problem(res, 409, "SKU already exists");
      return;
    }
    const product = { id: nextId++, ...parsed.data };
    products.set(product.id, product);
    res.setHeader("ETag", etagFor(product));
    res.status(201).json(product);
  });

  app.patch("/products/:id", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      problem(res, 404, "Not found");
      return;
    }
    const parsed = ProductPatch.safeParse(req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) Object.assign(p, { [k]: v });
    }
    bump(p);
    res.setHeader("ETag", etagFor(p));
    res.json(p);
  });

  app.patch("/products/:id/stock", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      problem(res, 404, "Not found");
      return;
    }
    if (!preconditionOk(req, res, p)) return;
    const parsed = StockChange.safeParse(req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    if (p.quantity + parsed.data.delta < 0) {
      problem(res, 422, "Insufficient stock");
      return;
    }
    const { delta } = parsed.data;
    if (delta !== 0) {
      record(p, delta > 0 ? "in" : "out", delta, "stock update");
    }
    res.setHeader("ETag", etagFor(p));
    res.json(p);
  });

  app.post("/stock/batch", (req, res) => {
    const rawItems = (req.body as { items?: unknown } | undefined)?.items;
    if (Array.isArray(rawItems) && rawItems.length > BATCH_MAX) {
      problem(res, 413, `Batch exceeds ${BATCH_MAX} items`);
      return;
    }
    const parsed = BatchInput.safeParse(req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    // validate everything against running balances before mutating anything
    const balances = new Map<number, number>();
    const failures: { index: number; id: number; reason: string }[] = [];
    parsed.data.items.forEach(({ id, delta }, index) => {
      const p = products.get(id);
      if (!p) {
        failures.push({ index, id, reason: "Product not found" });
        return;
      }
      const next = (balances.get(id) ?? p.quantity) + delta;
      if (next < 0) {
        failures.push({ index, id, reason: "Insufficient stock" });
        return;
      }
      balances.set(id, next);
    });
    if (failures.length > 0) {
      problem(res, 422, "Batch rejected; no adjustments applied", {
        errors: failures,
      });
      return;
    }
    const touched = new Map<number, Product>();
    for (const { id, delta, reason } of parsed.data.items) {
      const p = products.get(id) as Product;
      if (delta !== 0) {
        record(p, delta > 0 ? "in" : "out", delta, reason ?? "batch adjustment");
      }
      touched.set(id, p);
    }
    res.json([...touched.values()]);
  });

  app.post("/products/:id/movements", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      problem(res, 404, "Not found");
      return;
    }
    if (!preconditionOk(req, res, p)) return;
    const parsed = MovementInput.safeParse(req.body);
    if (!parsed.success) {
      invalid(res, parsed.error);
      return;
    }
    const { type, quantity, reason, reference } = parsed.data;
    // adjust sets stock to an absolute counted quantity
    const delta =
      type === "in"
        ? quantity
        : type === "out"
          ? -quantity
          : quantity - p.quantity;
    if (p.quantity + delta < 0) {
      problem(res, 400, "Stock cannot go negative");
      return;
    }
    res.status(201).json(record(p, type, delta, reason, reference));
  });

  app.get("/products/:id/movements", (req, res) => {
    const id = Number(req.params.id);
    if (!products.has(id)) {
      problem(res, 404, "Not found");
      return;
    }
    res.json([...(movements.get(id) ?? [])].reverse());
  });

  app.delete("/products/:id", (req, res) => {
    const id = Number(req.params.id);
    movements.delete(id);
    versions.delete(id);
    if (products.delete(id)) res.status(204).end();
    else problem(res, 404, "Not found");
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    problem(res, 400, err.message);
  });

  return app;
}
