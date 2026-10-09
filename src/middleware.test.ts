import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("rate limiting", () => {
  it("returns 429 after the limit is exceeded", async () => {
    const app = createApp({ rateLimit: { max: 2, windowMs: 60_000 }, log: () => {} });
    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(200);
    const res = await request(app).get("/health").expect(429);
    expect(res.body).toEqual({ error: "Too many requests" });
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("resets after the window passes", async () => {
    let now = 0;
    const app = createApp({
      rateLimit: { max: 1, windowMs: 1000 },
      log: () => {},
      now: () => now,
    });
    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(429);
    now = 1001;
    await request(app).get("/health").expect(200);
  });
});

describe("request logging", () => {
  it("logs a JSON line with method, path, status and ms", async () => {
    const lines: string[] = [];
    const app = createApp({ log: (l) => lines.push(l) });
    await request(app).get("/health").expect(200);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ method: "GET", path: "/health", status: 200 });
    expect(typeof entry.ms).toBe("number");
  });

  it("logs 429 responses too", async () => {
    const lines: string[] = [];
    const app = createApp({
      rateLimit: { max: 1, windowMs: 60_000 },
      log: (l) => lines.push(l),
    });
    await request(app).get("/health");
    await request(app).get("/health").expect(429);
    expect(JSON.parse(lines[1]!).status).toBe(429);
  });
});
