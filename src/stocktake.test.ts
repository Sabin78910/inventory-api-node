import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const KEY = "secret";
const mk = () => createApp({ apiKey: KEY, log: () => {} });
const seed = async (app: ReturnType<typeof createApp>) =>
  (
    await request(app)
      .post("/products")
      .set("X-API-Key", KEY)
      .send({ name: "Widget", sku: "W-1", price: 2.5, quantity: 4 })
  ).body;
const count = (app: ReturnType<typeof createApp>, id: number, body: unknown) =>
  request(app)
    .post(`/products/${id}/stocktake`)
    .set("X-API-Key", KEY)
    .send(body as object);

describe("POST /products/:id/stocktake", () => {
  it("sets stock up and records the variance", async () => {
    const app = mk();
    const p = await seed(app);
    const res = await count(app, p.id, { counted: 10 }).expect(200);
    expect(res.body.product.quantity).toBe(10);
    expect(res.body.movement).toMatchObject({
      productId: p.id,
      type: "adjust",
      delta: 6,
      balance: 10,
      reason: "stocktake",
    });
    const list = await request(app).get(`/products/${p.id}/movements`);
    expect(list.body).toHaveLength(1);
  });

  it("sets stock down with a custom reason", async () => {
    const app = mk();
    const p = await seed(app);
    const res = await count(app, p.id, { counted: 1, reason: "shelf count" });
    expect(res.status).toBe(200);
    expect(res.body.product.quantity).toBe(1);
    expect(res.body.movement).toMatchObject({ delta: -3, reason: "shelf count" });
  });

  it("changes nothing and records no movement on zero variance", async () => {
    const app = mk();
    const p = await seed(app);
    const before = (await request(app).get(`/products/${p.id}`)).headers.etag;
    const res = await count(app, p.id, { counted: 4 }).expect(200);
    expect(res.body.movement).toBeNull();
    expect(res.body.product.quantity).toBe(4);
    expect(
      (await request(app).get(`/products/${p.id}`)).headers.etag,
    ).toBe(before);
    const list = await request(app).get(`/products/${p.id}/movements`);
    expect(list.body).toHaveLength(0);
  });

  it.each([
    [{ counted: -1 }],
    [{ counted: 1.5 }],
    [{}],
    [{ counted: 2, reason: "" }],
    [{ counted: 2, reason: "x".repeat(201) }],
  ])("rejects invalid body %j", async (body) => {
    const app = mk();
    const p = await seed(app);
    const res = await count(app, p.id, body).expect(400);
    expect(res.type).toBe("application/problem+json");
  });

  it("requires the API key", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app)
      .post(`/products/${p.id}/stocktake`)
      .send({ counted: 2 })
      .expect(401);
  });

  it("returns 404 problem+json for an unknown id", async () => {
    const res = await count(mk(), 999, { counted: 2 }).expect(404);
    expect(res.type).toBe("application/problem+json");
  });

  it("honours If-Match", async () => {
    const app = mk();
    const p = await seed(app);
    await count(app, p.id, { counted: 2 })
      .set("If-Match", '"stale"')
      .expect(412);
    const etag = (await request(app).get(`/products/${p.id}`)).headers.etag;
    const ok = await count(app, p.id, { counted: 2 })
      .set("If-Match", etag)
      .expect(200);
    expect(ok.headers.etag).toBeTruthy();
  });
});
