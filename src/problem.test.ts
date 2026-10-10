import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = (o = {}) => createApp({ log: () => {}, ...o });
const shape = (res: request.Response, status: number) => {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({
    type: "about:blank",
    status,
    title: expect.any(String),
    detail: expect.any(String),
    error: expect.anything(),
  });
};
const widget = { name: "W", sku: "W-1", price: 1, quantity: 1 };

describe("problem+json errors", () => {
  it("400 validation includes field errors", async () => {
    const res = await request(mk()).post("/products").send({ name: "" });
    shape(res, 400);
    expect(res.body.title).toBe("Bad Request");
    expect(res.body.errors.name).toBeDefined();
    expect(res.body.error.fieldErrors.name).toBeDefined();
  });

  it("400 on malformed JSON", async () => {
    const res = await request(mk())
      .post("/products")
      .set("content-type", "application/json")
      .send("{bad");
    shape(res, 400);
  });

  it("401", async () => {
    const res = await request(mk({ apiKey: "k" }))
      .post("/products")
      .send(widget);
    shape(res, 401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("404", async () => {
    const res = await request(mk()).get("/products/99");
    shape(res, 404);
    expect(res.body.error).toBe("Not found");
    shape(await request(mk()).delete("/products/99"), 404);
  });

  it("409", async () => {
    const app = mk();
    await request(app).post("/products").send(widget);
    shape(await request(app).post("/products").send(widget), 409);
  });

  it("412", async () => {
    const app = mk();
    await request(app).post("/products").send(widget);
    const res = await request(app)
      .patch("/products/1/stock")
      .set("If-Match", '"nope"')
      .send({ delta: 1 });
    shape(res, 412);
  });

  it("422", async () => {
    const app = mk();
    await request(app).post("/products").send(widget);
    shape(
      await request(app).patch("/products/1/stock").send({ delta: -5 }),
      422,
    );
  });

  it("429 keeps Retry-After", async () => {
    const app = mk({ rateLimit: { max: 1, windowMs: 60_000 } });
    await request(app).get("/health");
    const res = await request(app).get("/health");
    shape(res, 429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
