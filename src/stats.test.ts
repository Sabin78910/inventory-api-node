import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("GET /stats", () => {
  it("is empty on a fresh app", async () => {
    const res = await request(createApp()).get("/stats").expect(200);
    expect(res.body).toEqual({
      productCount: 0,
      lowStockCount: 0,
      recentMovements: [],
    });
  });

  it("counts products, low stock and lists newest movements first", async () => {
    const app = createApp();
    const mk = (sku: string, quantity: number) =>
      request(app).post("/products").send({ name: sku, sku, price: 1, quantity });
    await mk("A", 50);
    await mk("B", 3);
    await request(app).patch("/products/1/stock").send({ delta: -1 });
    await request(app).patch("/products/2/stock").send({ delta: 2 });
    const res = await request(app).get("/stats").expect(200);
    expect(res.body.productCount).toBe(2);
    expect(res.body.lowStockCount).toBe(1);
    expect(res.body.recentMovements.map((m: { id: number }) => m.id)).toEqual([2, 1]);
    expect(res.body.recentMovements[0]).toMatchObject({ productId: 2, delta: 2 });
  });

  it("caps recent movements at 5", async () => {
    const app = createApp();
    await request(app).post("/products").send({ name: "A", sku: "A", price: 1, quantity: 100 });
    for (let i = 0; i < 7; i++) {
      await request(app).patch("/products/1/stock").send({ delta: 1 });
    }
    const res = await request(app).get("/stats").expect(200);
    expect(res.body.recentMovements).toHaveLength(5);
  });
});

describe("landing page v2", () => {
  it("sends a strict CSP without external origins or unsafe-inline scripts", async () => {
    const res = await request(createApp()).get("/").expect(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toMatch(/unsafe-inline/);
    expect(csp).toContain("connect-src 'self'");
    expect(res.text).not.toContain("fonts.googleapis.com");
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
    expect(res.text).toContain(`<script nonce="${nonce}">`);
  });

  it("has a playground and curl examples", async () => {
    const res = await request(createApp()).get("/").expect(200);
    expect(res.text).toContain('id="playground"');
    expect(res.text).toContain("/stats");
    expect(res.text).toContain("curl");
  });
});
