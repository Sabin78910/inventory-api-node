import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const KEY = "secret";
const mk = () => createApp({ apiKey: KEY, log: () => {} });
type App = ReturnType<typeof createApp>;
const seed = async (app: App, sku = "W-1", quantity = 4) =>
  (
    await request(app)
      .post("/products")
      .set("X-API-Key", KEY)
      .send({ name: "Widget", sku, price: 2.5, quantity })
  ).body;
const patch = (app: App, id: number, body: unknown) =>
  request(app)
    .patch(`/products/${id}`)
    .set("X-API-Key", KEY)
    .send(body as object);

describe("archiving products", () => {
  it("defaults archived to false", async () => {
    const p = await seed(mk());
    expect(p.archived).toBe(false);
  });

  it("archives, hides from lists, and restores", async () => {
    const app = mk();
    const a = await seed(app, "A", 1);
    const b = await seed(app, "B", 1);
    const res = await patch(app, a.id, { archived: true }).expect(200);
    expect(res.body.archived).toBe(true);

    const active = await request(app).get("/products");
    expect(active.body.items.map((p: { id: number }) => p.id)).toEqual([b.id]);
    expect(active.body.total).toBe(1);
    const archived = await request(app).get("/products?archived=true");
    expect(archived.body.items.map((p: { id: number }) => p.id)).toEqual([a.id]);

    await patch(app, a.id, { archived: false }).expect(200);
    const all = await request(app).get("/products");
    expect(all.body.total).toBe(2);
    const none = await request(app).get("/products?archived=true");
    expect(none.body.total).toBe(0);
  });

  it("keeps archived products readable with their history", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app)
      .patch(`/products/${p.id}/stock`)
      .set("X-API-Key", KEY)
      .send({ delta: 2 })
      .expect(200);
    await patch(app, p.id, { archived: true }).expect(200);
    const got = await request(app).get(`/products/${p.id}`).expect(200);
    expect(got.body.archived).toBe(true);
    const moves = await request(app).get(`/products/${p.id}/movements`).expect(200);
    expect(moves.body).toHaveLength(1);
  });

  it("excludes archived products from alerts, stats, summary and keeps them in csv", async () => {
    const app = mk();
    const p = await seed(app, "A", 1);
    await seed(app, "B", 100);
    await patch(app, p.id, { archived: true }).expect(200);
    expect((await request(app).get("/alerts/low-stock")).body).toEqual([]);
    expect((await request(app).get("/stats")).body.productCount).toBe(1);
    const s = (await request(app).get("/summary")).body;
    expect(s).toMatchObject({ productCount: 1, totalUnits: 100 });
    const csv = (await request(app).get("/products.csv")).text;
    expect(csv.split("\r\n")[0]).toContain("archived");
    expect(csv).toContain("A,");
    expect(csv).toMatch(/A,.*,true/);
  });

  it("rejects a non-boolean archived value", async () => {
    const app = mk();
    const p = await seed(app);
    const res = await patch(app, p.id, { archived: "yes" }).expect(400);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
  });

  it("rejects an invalid archived query", async () => {
    const res = await request(mk()).get("/products?archived=maybe").expect(400);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
  });

  it("requires the API key to archive", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app)
      .patch(`/products/${p.id}`)
      .send({ archived: true })
      .expect(401);
  });

  it("returns 409 for stock changes on an archived product", async () => {
    const app = mk();
    const p = await seed(app);
    await patch(app, p.id, { archived: true }).expect(200);
    const send = (method: "patch" | "post", path: string, body: object) =>
      request(app)[method](`/products/${p.id}${path}`).set("X-API-Key", KEY).send(body);
    for (const r of [
      await send("patch", "/stock", { delta: 1 }),
      await send("post", "/stocktake", { counted: 3 }),
      await send("post", "/movements", { type: "in", quantity: 1, reason: "x" }),
      await request(app)
        .post("/stock/batch")
        .set("X-API-Key", KEY)
        .send({ items: [{ id: p.id, delta: 1 }] }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.headers["content-type"]).toMatch(/problem\+json/);
    }
    const moves = await request(app).get(`/products/${p.id}/movements`);
    expect(moves.body).toHaveLength(0);
  });
});
