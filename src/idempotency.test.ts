import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const body = { name: "Widget", sku: "W-1", price: 2.5, quantity: 4 };

describe("Idempotency-Key on POST /products", () => {
  it("replays the original response without creating a duplicate", async () => {
    const app = createApp({ log: () => {} });
    const a = await request(app)
      .post("/products")
      .set("Idempotency-Key", "k1")
      .send(body)
      .expect(201);
    expect(a.headers["idempotent-replayed"]).toBeUndefined();
    const b = await request(app)
      .post("/products")
      .set("Idempotency-Key", "k1")
      .send(body)
      .expect(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    const list = await request(app).get("/products");
    expect(list.body.total ?? list.body.items?.length).toBe(1);
  });

  it("returns 422 for same key with a different body", async () => {
    const app = createApp({ log: () => {} });
    await request(app)
      .post("/products")
      .set("Idempotency-Key", "k1")
      .send(body)
      .expect(201);
    const r = await request(app)
      .post("/products")
      .set("Idempotency-Key", "k1")
      .send({ ...body, sku: "W-2" })
      .expect(422);
    expect(r.body.error).toMatch(/Idempotency-Key/);
  });

  it("is unchanged without the header", async () => {
    const app = createApp({ log: () => {} });
    await request(app).post("/products").send(body).expect(201);
    await request(app).post("/products").send(body).expect(409);
  });

  it("expires keys after 24h", async () => {
    let t = 1_000_000;
    const app = createApp({ log: () => {}, now: () => t });
    const post = () =>
      request(app).post("/products").set("Idempotency-Key", "k1").send(body);
    await post().expect(201);
    t += 24 * 3600 * 1000 - 1;
    await post().expect(201);
    t += 24 * 3600 * 1000;
    const r = await post().expect(409);
    expect(r.headers["idempotent-replayed"]).toBeUndefined();
  });
});
