import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

async function setup(apiKey?: string) {
  const app = createApp({ apiKey, log: () => {} });
  const h = apiKey ? { "X-API-Key": apiKey } : {};
  const mk = async (sku: string, quantity: number) =>
    (await request(app).post("/products").set(h).send({ name: sku, sku, price: 1, quantity })).body
      .id as number;
  return { app, h, a: await mk("A", 5), b: await mk("B", 2) };
}

describe("POST /stock/batch", () => {
  it("applies all items and records one movement each", async () => {
    const { app, a, b } = await setup();
    const res = await request(app)
      .post("/stock/batch")
      .send({ items: [{ id: a, delta: 3, reason: "delivery" }, { id: b, delta: -2 }] })
      .expect(200);
    expect(res.body.map((p: { quantity: number }) => p.quantity)).toEqual([8, 0]);
    const mv = (await request(app).get(`/products/${a}/movements`)).body;
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ delta: 3, reason: "delivery" });
  });

  it("rolls back and lists failures by index", async () => {
    const { app, a, b } = await setup();
    const res = await request(app)
      .post("/stock/batch")
      .send({ items: [{ id: a, delta: 1 }, { id: b, delta: -3 }, { id: 999, delta: 1 }] })
      .expect(422);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
    expect(res.body.errors.map((e: { index: number }) => e.index)).toEqual([1, 2]);
    expect((await request(app).get(`/products/${a}`)).body.quantity).toBe(5);
    expect((await request(app).get(`/products/${a}/movements`)).body).toHaveLength(0);
  });

  it("checks duplicates cumulatively, in order", async () => {
    const { app, a } = await setup();
    await request(app)
      .post("/stock/batch")
      .send({ items: [{ id: a, delta: -5 }, { id: a, delta: 2 }, { id: a, delta: -2 }] })
      .expect(200);
    expect((await request(app).get(`/products/${a}`)).body.quantity).toBe(0);
    const bad = await request(app)
      .post("/stock/batch")
      .send({ items: [{ id: a, delta: -1 }] })
      .expect(422);
    expect(bad.body.errors[0]).toMatchObject({ index: 0 });
  });

  it("rejects invalid bodies with 400 and oversize with 413", async () => {
    const { app, a } = await setup();
    await request(app).post("/stock/batch").send({ items: [] }).expect(400);
    await request(app).post("/stock/batch").send({}).expect(400);
    await request(app).post("/stock/batch").send({ items: [{ id: a, delta: 1.5 }] }).expect(400);
    const big = Array.from({ length: 101 }, () => ({ id: a, delta: 1 }));
    const res = await request(app).post("/stock/batch").send({ items: big }).expect(413);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
    const ok = Array.from({ length: 100 }, () => ({ id: a, delta: 1 }));
    await request(app).post("/stock/batch").send({ items: ok }).expect(200);
  });

  it("requires the API key", async () => {
    const { app, h, a } = await setup("secret");
    const body = { items: [{ id: a, delta: 1 }] };
    await request(app).post("/stock/batch").send(body).expect(401);
    await request(app).post("/stock/batch").set(h).send(body).expect(200);
  });
});
