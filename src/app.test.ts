import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const sample = { name: "Pashmina Shawl", sku: "PS-01", price: 2500, quantity: 10 };

describe("inventory api", () => {
  it("health check", async () => {
    await request(createApp()).get("/health").expect(200, { status: "ok" });
  });

  it("creates, lists and updates stock", async () => {
    const app = createApp();
    const { body } = await request(app).post("/products").send(sample).expect(201);
    await request(app).post("/products").send(sample).expect(409);
    await request(app).patch(`/products/${body.id}/stock`).send({ delta: -8 }).expect(200);
    const low = await request(app).get("/products?lowStock=2").expect(200);
    expect(low.body).toHaveLength(1);
    await request(app).patch(`/products/${body.id}/stock`).send({ delta: -5 }).expect(422);
    await request(app).delete(`/products/${body.id}`).expect(204);
    await request(app).get(`/products/${body.id}`).expect(404);
  });

  it("validates input", async () => {
    await request(createApp()).post("/products").send({ name: "", price: -1 }).expect(400);
  });

  it("searches by name or sku case-insensitively", async () => {
    const app = createApp();
    await request(app).post("/products").send(sample).expect(201);
    await request(app).post("/products").send({ ...sample, name: "Tea", sku: "TE-02" }).expect(201);
    const byName = await request(app).get("/products?q=shaWL").expect(200);
    expect(byName.body.map((p: { sku: string }) => p.sku)).toEqual(["PS-01"]);
    const bySku = await request(app).get("/products?q=te-0").expect(200);
    expect(bySku.body.map((p: { sku: string }) => p.sku)).toEqual(["TE-02"]);
    const none = await request(app).get("/products?q=zzz").expect(200);
    expect(none.body).toEqual([]);
    const all = await request(app).get("/products?q=").expect(200);
    expect(all.body).toHaveLength(2);
  });
});
