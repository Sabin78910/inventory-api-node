import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("X-Request-Id", () => {
  it("generates a UUID when none is sent", async () => {
    const res = await request(createApp({ log: () => {} })).get("/health");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("echoes a valid incoming id", async () => {
    const res = await request(createApp({ log: () => {} }))
      .get("/health")
      .set("X-Request-Id", "abc.DEF_123-x");
    expect(res.headers["x-request-id"]).toBe("abc.DEF_123-x");
  });

  it("replaces ids with bad characters", async () => {
    const res = await request(createApp({ log: () => {} }))
      .get("/health")
      .set("X-Request-Id", "bad id;<x>");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("replaces ids longer than 64 chars and accepts exactly 64", async () => {
    const app = createApp({ log: () => {} });
    const long = await request(app)
      .get("/health")
      .set("X-Request-Id", "a".repeat(65));
    expect(long.headers["x-request-id"]).toMatch(UUID);
    const ok = await request(app)
      .get("/health")
      .set("X-Request-Id", "a".repeat(64));
    expect(ok.headers["x-request-id"]).toBe("a".repeat(64));
  });

  it("puts the id in the log line", async () => {
    const lines: string[] = [];
    await request(createApp({ log: (l) => lines.push(l) }))
      .get("/health")
      .set("X-Request-Id", "log-me");
    expect(JSON.parse(lines[0]).requestId).toBe("log-me");
  });

  it("includes requestId in error bodies, equal to the header", async () => {
    const app = createApp({ log: () => {}, apiKey: "k" });
    const nf = await request(app).get("/products/99").set("X-Request-Id", "r1");
    expect(nf.status).toBe(404);
    expect(nf.body.requestId).toBe("r1");
    expect(nf.headers["x-request-id"]).toBe("r1");
    const un = await request(app).post("/products").send({});
    expect(un.status).toBe(401);
    expect(un.body.requestId).toBe(un.headers["x-request-id"]);
  });

  it("includes requestId on 429", async () => {
    const app = createApp({
      log: () => {},
      rateLimit: { max: 1, windowMs: 60_000 },
    });
    await request(app).get("/health");
    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("exposes the header via CORS", async () => {
    const res = await request(createApp({ log: () => {} }))
      .get("/health")
      .set("Origin", "https://sabin78910.github.io");
    expect(res.headers["access-control-expose-headers"]).toMatch(
      /X-Request-Id/i,
    );
  });
});
