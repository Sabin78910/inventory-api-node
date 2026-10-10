import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = () => createApp({ log: () => {} });
const seed = async (app: ReturnType<typeof createApp>) =>
  (
    await request(app)
      .post("/products")
      .send({ name: "Widget", sku: "W-1", price: 2.5, quantity: 4 })
  ).body;
const etagOf = async (app: ReturnType<typeof createApp>, id: number) =>
  (await request(app).get(`/products/${id}`)).headers.etag as string;

describe("ETag / If-Match", () => {
  it("sets an ETag that changes after stock changes and edits", async () => {
    const app = mk();
    const p = await seed(app);
    const e1 = await etagOf(app, p.id);
    expect(e1).toBeTruthy();
    expect(await etagOf(app, p.id)).toBe(e1);
    await request(app)
      .patch(`/products/${p.id}/stock`)
      .send({ delta: 1 })
      .expect(200);
    const e2 = await etagOf(app, p.id);
    expect(e2).not.toBe(e1);
    await request(app)
      .post(`/products/${p.id}/movements`)
      .send({ type: "out", quantity: 1, reason: "x" })
      .expect(201);
    const e3 = await etagOf(app, p.id);
    expect(e3).not.toBe(e2);
    await request(app)
      .patch(`/products/${p.id}`)
      .send({ price: 9 })
      .expect(200);
    expect(await etagOf(app, p.id)).not.toBe(e3);
  });

  it("accepts a matching If-Match and rejects a stale one on stock PATCH", async () => {
    const app = mk();
    const p = await seed(app);
    const e1 = await etagOf(app, p.id);
    await request(app)
      .patch(`/products/${p.id}/stock`)
      .set("If-Match", e1)
      .send({ delta: 2 })
      .expect(200);
    const res = await request(app)
      .patch(`/products/${p.id}/stock`)
      .set("If-Match", e1)
      .send({ delta: 5 })
      .expect(412);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect((await request(app).get(`/products/${p.id}`)).body.quantity).toBe(6);
  });

  it("enforces If-Match on movements without changing stock", async () => {
    const app = mk();
    const p = await seed(app);
    const e1 = await etagOf(app, p.id);
    const body = { type: "in", quantity: 3, reason: "r" };
    await request(app)
      .post(`/products/${p.id}/movements`)
      .set("If-Match", e1)
      .send(body)
      .expect(201);
    await request(app)
      .post(`/products/${p.id}/movements`)
      .set("If-Match", e1)
      .send(body)
      .expect(412);
    expect((await request(app).get(`/products/${p.id}`)).body.quantity).toBe(7);
    const fresh = await etagOf(app, p.id);
    await request(app)
      .post(`/products/${p.id}/movements`)
      .set("If-Match", `"nope", ${fresh}`)
      .send(body)
      .expect(201);
    await request(app)
      .post(`/products/${p.id}/movements`)
      .set("If-Match", "*")
      .send(body)
      .expect(201);
  });

  it("behaves as before without If-Match", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app)
      .patch(`/products/${p.id}/stock`)
      .send({ delta: 1 })
      .expect(200);
  });

  it("returns 304 for a matching If-None-Match", async () => {
    const app = mk();
    const p = await seed(app);
    const e1 = await etagOf(app, p.id);
    await request(app)
      .get(`/products/${p.id}`)
      .set("If-None-Match", e1)
      .expect(304);
    await request(app).patch(`/products/${p.id}/stock`).send({ delta: 1 });
    await request(app)
      .get(`/products/${p.id}`)
      .set("If-None-Match", e1)
      .expect(200);
  });
});
