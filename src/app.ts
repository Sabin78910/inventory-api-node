import { createHash, timingSafeEqual } from "node:crypto";
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
});
const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["price", "name"]).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(100).optional(),
});
const StockChange = z.object({ delta: z.number().int() });
const MovementInput = z.object({
  type: z.enum(["in", "out", "adjust"]),
  quantity: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(100).optional(),
});

const CSV_HEADER = ["name", "sku", "price", "quantity", "reorderLevel"];
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
  let nextId = 1;
  let nextMovementId = 1;
  const record = (
    p: Product,
    type: Movement["type"],
    delta: number,
    reason: string,
    reference?: string,
  ) => {
    p.quantity += delta;
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
      res.status(429).json({ error: "Too many requests" });
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
    res.status(401).json({ error: "Unauthorized" });
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
      res.status(400).json({ error: page.error.flatten() });
      return;
    }
    const { limit, offset, sort, order, q } = page.data;
    const needle = q?.toLowerCase();
    const all = [...products.values()].filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        p.sku.toLowerCase().includes(needle),
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
        [p.name, p.sku, p.price, p.quantity, p.reorderLevel]
          .map(csvCell)
          .join(","),
      );
    }
    res.type("text/csv").send(lines.join("\r\n") + "\r\n");
  });

  app.post("/products/import", (req, res) => {
    if (typeof req.body !== "string" || !req.body.trim()) {
      res.status(400).json({ error: "Expected a non-empty text/csv body" });
      return;
    }
    const [header, ...data] = parseCsv(req.body);
    const cols = header?.map((h) => h.trim());
    if (!cols || !CSV_HEADER.slice(0, 4).every((h) => cols.includes(h))) {
      res.status(400).json({
        error: `Header must include: ${CSV_HEADER.slice(0, 4).join(", ")}`,
      });
      return;
    }
    const skus = new Set([...products.values()].map((p) => p.sku));
    const rows: { row: number; ok: boolean; errors?: string[] }[] = [];
    data.forEach((cells, i) => {
      const row = i + 2;
      const get = (k: string) => cells[cols.indexOf(k)]?.trim() ?? "";
      const rl = get("reorderLevel");
      const parsed = ProductInput.safeParse({
        name: get("name"),
        sku: get("sku"),
        price: get("price") === "" ? NaN : Number(get("price")),
        quantity: get("quantity") === "" ? NaN : Number(get("quantity")),
        ...(rl === "" ? {} : { reorderLevel: Number(rl) }),
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
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(p);
  });

  app.post("/products", (req, res) => {
    const parsed = ProductInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if ([...products.values()].some((p) => p.sku === parsed.data.sku)) {
      res.status(409).json({ error: "SKU already exists" });
      return;
    }
    const product = { id: nextId++, ...parsed.data };
    products.set(product.id, product);
    res.status(201).json(product);
  });

  app.patch("/products/:id/stock", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = StockChange.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (p.quantity + parsed.data.delta < 0) {
      res.status(422).json({ error: "Insufficient stock" });
      return;
    }
    const { delta } = parsed.data;
    if (delta !== 0) {
      record(p, delta > 0 ? "in" : "out", delta, "stock update");
    }
    res.json(p);
  });

  app.post("/products/:id/movements", (req, res) => {
    const p = products.get(Number(req.params.id));
    if (!p) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = MovementInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
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
      res.status(400).json({ error: "Stock cannot go negative" });
      return;
    }
    res.status(201).json(record(p, type, delta, reason, reference));
  });

  app.get("/products/:id/movements", (req, res) => {
    const id = Number(req.params.id);
    if (!products.has(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json([...(movements.get(id) ?? [])].reverse());
  });

  app.delete("/products/:id", (req, res) => {
    const id = Number(req.params.id);
    movements.delete(id);
    res.status(products.delete(id) ? 204 : 404).end();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message });
  });

  return app;
}
