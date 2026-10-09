import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("landing page", () => {
  it("serves HTML with title, endpoint cards and spec links", async () => {
    const res = await request(createApp()).get("/").expect(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("<title>Inventory API</title>");
    expect(res.text).toContain("/openapi.json");
    expect(res.text).toContain("editor.swagger.io");
    expect(res.text).toContain("curl");
  });

  it("shows live counts from the summary", async () => {
    const app = createApp();
    await request(app)
      .post("/products")
      .send({ name: "Widget", sku: "W-1", price: 2.5, quantity: 4 });
    const res = await request(app).get("/").expect(200);
    expect(res.text).toContain('data-stat="products">1<');
    expect(res.text).toContain('data-stat="units">4<');
    expect(res.text).toContain('data-stat="value">10.00<');
  });

  it("leaves JSON endpoints unchanged", async () => {
    const app = createApp();
    const res = await request(app).get("/summary").expect(200);
    expect(res.body).toEqual({ productCount: 0, totalUnits: 0, totalValue: 0 });
    await request(app).get("/health").expect(200, { status: "ok" });
  });
});
