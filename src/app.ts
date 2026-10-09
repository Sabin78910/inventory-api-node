import express, { type NextFunction, type Request, type Response } from "express";
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
});
const StockChange = z.object({ delta: z.number().int() });

export interface Product extends z.infer<typeof ProductInput> {
  id: number;
}

export function createApp() {
  const products = new Map<number, Product>();
  let nextId = 1;
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/products", (req, res) => {
    const low = req.query.lowStock ? Number(req.query.lowStock) : null;
    const page = PageQuery.safeParse(req.query);
    if (!page.success) {
      res.status(400).json({ error: page.error.flatten() });
      return;
    }
    const { limit, offset } = page.data;
    const all = [...products.values()];
    const byStock = low === null || Number.isNaN(low) ? all : all.filter((p) => p.quantity <= low);
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const list = q
      ? byStock.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      : byStock;
    res.json({ items: list.slice(offset, offset + limit), total: list.length, limit, offset });
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
