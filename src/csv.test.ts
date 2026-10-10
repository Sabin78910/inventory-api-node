import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = (apiKey?: string) => createApp({ apiKey, log: () => {} });
const imp = (app: ReturnType<typeof mk>, csv: string) =>
  request(app).post("/products/import").set("Content-Type", "text/csv").send(csv);

describe("CSV export", () => {
  it("exports products with header, quoting and formula escaping", async () => {
    const app = mk();
    await request(app).post("/products").send({ name: 'Bolt, "M6"', sku: "B1", price: 1.5, quantity: 3 });
    await request(app).post("/products").send({ name: "=cmd", sku: "B2", price: 2, quantity: 0, reorderLevel: 5 });
    const res = await request(app).get("/products.csv").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.split("\r\n")).toEqual([
      "name,sku,price,quantity,reorderLevel,category",
      '"Bolt, ""M6""",B1,1.5,3,,',
      "'=cmd,B2,2,0,5,",
      "",
    ]);
  });

  it("exports just the header when empty", async () => {
    const res = await request(mk()).get("/products.csv").expect(200);
    expect(res.text).toBe("name,sku,price,quantity,reorderLevel,category\r\n");
  });
});

describe("CSV import", () => {
  it("imports valid rows and reports invalid ones per row", async () => {
    const app = mk();
    const csv = [
      "name,sku,price,quantity,reorderLevel,category",
      "Widget,W1,2.5,10,",
      ",W2,1,1,",
      "Gadget,W1,1,1,",
      "Thing,T1,abc,1,",
      '"Big, Thing",T2,3,4,2',
    ].join("\n");
    const res = await imp(app, csv).expect(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.failed).toBe(3);
    expect(res.body.rows.map((r: { row: number; ok: boolean }) => [r.row, r.ok])).toEqual([
      [2, true], [3, false], [4, false], [5, false], [6, true],
    ]);
    expect(res.body.rows[2].errors).toContain("SKU already exists");
    const list = await request(app).get("/products").expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items[1]).toMatchObject({ name: "Big, Thing", reorderLevel: 2 });
  });

  it("rejects a bad header and empty body", async () => {
    await imp(mk(), "a,b\n1,2").expect(400);
    await imp(mk(), "").expect(400);
  });

  it("requires the API key when configured", async () => {
    await imp(mk("k"), "name,sku,price,quantity\nA,A,1,1").expect(401);
    await imp(mk("k"), "name,sku,price,quantity\nA,A,1,1").set("X-API-Key", "k").expect(200);
  });
});
