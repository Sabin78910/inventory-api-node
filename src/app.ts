import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z } from "zod";

const ProductInput = z.object({
  name: z.string().trim().min(1).max(100),
  sku: z.string().trim().min(1).max(40),
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
});
const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["price", "name"]).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(100).optional(),
});
const StockChange = z.object({ delta: z.number().int() });

export interface Product extends z.infer<typeof ProductInput> {
  id: number;
}

export interface AppOptions {
  rateLimit?: { max: number; windowMs: number };
  log?: (line: string) => void;
  now?: () => number;
}

export function createApp(opts: AppOptions = {}) {
  const { max, windowMs } = opts.rateLimit ?? { max: 100, windowMs: 60_000 };
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const products = new Map<number, Product>();
  let nextId = 1;
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
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/summary", (_req, res) => {
    let totalUnits = 0;
    let totalValue = 0;
    for (const p of products.values()) {
      totalUnits += p.quantity;
      totalValue += p.quantity * p.price;
    }
    res.json({ productCount: products.size, totalUnits, totalValue });
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
    p.quantity += parsed.data.delta;
    res.json(p);
  });

  app.delete("/products/:id", (req, res) => {
    res.status(products.delete(Number(req.params.id)) ? 204 : 404).end();
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message });
  });

  return app;
}
