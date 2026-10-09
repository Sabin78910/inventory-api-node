import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const ORIGIN = "https://sabin78910.github.io";
const make = (allowedOrigins?: string[]) =>
  createApp({ log: () => {}, allowedOrigins });

describe("CORS (read-only)", () => {
  it("allows the default portfolio origin on GET /health", async () => {
    const res = await request(make())
      .get("/health")
      .set("Origin", ORIGIN)
      .expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it("does not send the header for unknown origins", async () => {
    const res = await request(make())
      .get("/health")
      .set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("honours a custom allow-list", async () => {
    const app = make(["https://a.example", "https://b.example"]);
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://b.example");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://b.example",
    );
    const other = await request(app).get("/health").set("Origin", ORIGIN);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a GET preflight", async () => {
    const res = await request(make())
      .options("/health")
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .expect(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toBe(
      "GET, HEAD, OPTIONS",
    );
  });

  it("does not allow a POST preflight", async () => {
    const res = await request(make())
      .options("/products")
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("does not add CORS headers to write responses", async () => {
    const res = await request(make())
      .post("/products")
      .set("Origin", ORIGIN)
      .send({ name: "W", sku: "W-1", price: 1, quantity: 1 })
      .expect(201);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
