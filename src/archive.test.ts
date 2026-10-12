import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = (apiKey?: string) => createApp({ apiKey, log: () => {} });
const seed = async (app: ReturnType<typeof createApp>, sku = "W-1") =>
  (
    await request(app)
      .post("/products")
      .send({ name: "Widget", sku, price: 2, quantity: 1 })
  ).body;

describe("archive and restore", () => {
  it("archives, hides from lists and totals, keeps history, then restores", async () => {
    const app = mk();
    const p = await seed(app);
    const keep = await seed(app, "W-2");
    expect(p.archived).toBe(false);
    await request(app).patch(`/products/${p.id}/stock`).send({ delta: 2 }).expect(200);

    const res = await request(app).patch(`/products/${p.id}`).send({ archived: true }).expect(200);
    expect(res.body.archived).toBe(true);

    const ids = (r: { body: { items: { id: number }[] } }) => r.body.items.map((i) => i.id);
    expect(ids(await request(app).get("/products"))).toEqual([keep.id]);
    expect(ids(await request(app).get("/products?archived=true"))).toEqual([p.id]);
    expect(ids(await request(app).get("/products?archived=false"))).toEqual([keep.id]);

    expect((await request(app).get("/alerts/low-stock")).body).toHaveLength(1);
    expect((await request(app).get("/stats")).body.productCount).toBe(1);
    expect((await request(app).get("/stats")).body.lowStockCount).toBe(1);
    expect((await request(app).get("/summary")).body).toEqual({
      productCount: 1,
      totalUnits: 1,
      totalValue: 2,
    });

    expect((await request(app).get(`/products/${p.id}`).expect(200)).body.archived).toBe(true);
    const moves = await request(app).get(`/products/${p.id}/movements`).expect(200);
    expect(moves.body).toHaveLength(1);

    const csv = await request(app).get("/products.csv").expect(200);
    expect(csv.text.split("\r\n")[0]).toBe("name,sku,price,quantity,reorderLevel,category,archived");
    expect(csv.text).toContain("W-1,2,3,,,true");

    await request(app).patch(`/products/${p.id}`).send({ archived: false }).expect(200);
    expect(ids(await request(app).get("/products"))).toEqual([p.id, keep.id]);
    await request(app).patch(`/products/${p.id}/stock`).send({ delta: 1 }).expect(200);
  });

  it("rejects stock changes on archived products with 409", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app).patch(`/products/${p.id}`).send({ archived: true });
    const checks = [
      request(app).patch(`/products/${p.id}/stock`).send({ delta: 1 }),
      request(app).post(`/products/${p.id}/stocktake`).send({ counted: 5 }),
      request(app)
        .post(`/products/${p.id}/movements`)
        .send({ type: "in", quantity: 1, reason: "x" }),
      request(app).post("/stock/batch").send({ items: [{ id: p.id, delta: 1 }] }),
    ];
    for (const r of await Promise.all(checks)) {
      expect(r.status).toBe(409);
      expect(r.headers["content-type"]).toMatch(/application\/problem\+json/);
    }
    expect((await request(app).get(`/products/${p.id}`)).body.quantity).toBe(1);
  });

  it("validates archived and the archived query", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app).patch(`/products/${p.id}`).send({ archived: "yes" }).expect(400);
    const bad = await request(app).get("/products?archived=maybe").expect(400);
    expect(bad.headers["content-type"]).toMatch(/application\/problem\+json/);
  });

  it("requires the API key to archive", async () => {
    const app = mk("secret");
    await request(app).patch("/products/1").send({ archived: true }).expect(401);
  });
});
