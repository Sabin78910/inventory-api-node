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
});
