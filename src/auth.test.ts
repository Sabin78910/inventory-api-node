import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const body = { name: "A", sku: "A1", price: 1, quantity: 1 };
const mk = (apiKey?: string) => createApp({ apiKey, log: () => {} });

describe("API key", () => {
  it("rejects writes without a key", async () => {
    const res = await request(mk("secret")).post("/products").send(body).expect(401);
    expect(res.body).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects wrong keys, including different lengths", async () => {
    const app = mk("secret");
    await request(app).post("/products").set("X-API-Key", "wrong!").send(body).expect(401);
    await request(app).post("/products").set("X-API-Key", "x").send(body).expect(401);
  });

  it("protects PATCH and DELETE", async () => {
    const app = mk("secret");
    await request(app).patch("/products/1/stock").send({ delta: 1 }).expect(401);
    await request(app).delete("/products/1").expect(401);
  });

  it("allows writes with the correct key", async () => {
    const app = mk("secret");
    await request(app).post("/products").set("X-API-Key", "secret").send(body).expect(201);
    await request(app).delete("/products/1").set("X-API-Key", "secret").expect(204);
  });

  it("keeps reads public", async () => {
    const app = mk("secret");
    await request(app).get("/products").expect(200);
    await request(app).get("/health").expect(200);
  });

  it("does not require a key when none is configured", async () => {
    await request(mk()).post("/products").send(body).expect(201);
  });
});
