import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = () => createApp({ log: () => {} });
const add = (app: ReturnType<typeof mk>, sku: string, body: object = {}) =>
  request(app).post("/products").send({ name: `N-${sku}`, sku, price: 1, quantity: 1, ...body });

describe("product category", () => {
  it("accepts a trimmed category on create and PATCH", async () => {
    const app = mk();
    const res = await add(app, "A", { category: "  Cables " }).expect(201);
    expect(res.body.category).toBe("Cables");
    const p = await request(app).patch(`/products/${res.body.id}`).send({ category: "Hubs" }).expect(200);
    expect(p.body.category).toBe("Hubs");
  });

  it("rejects empty or too-long categories", async () => {
    const app = mk();
    await add(app, "A", { category: "   " }).expect(400);
    await add(app, "B", { category: "x".repeat(51) }).expect(400);
    const { body } = await add(app, "C").expect(201);
    await request(app).patch(`/products/${body.id}`).send({ category: "" }).expect(400);
  });

  it("filters case-insensitively, combined with search, sort and pagination", async () => {
    const app = mk();
    await add(app, "A", { category: "Cables", price: 3 });
    await add(app, "B", { category: "cables", price: 1 });
    await add(app, "C", { category: "Cables", price: 2, name: "Other" });
    await add(app, "D", { category: "Hubs" });
    await add(app, "E");
    const all = await request(app).get("/products?category=CABLES").expect(200);
    expect(all.body.total).toBe(3);
    const q = await request(app).get("/products?category=cables&q=other").expect(200);
    expect(q.body.items.map((i: { sku: string }) => i.sku)).toEqual(["C"]);
    const page = await request(app)
      .get("/products?category=cables&sort=price&limit=1&offset=1")
      .expect(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items.map((i: { sku: string }) => i.sku)).toEqual(["C"]);
    const none = await request(app).get("/products?category=nope").expect(200);
    expect(none.body.total).toBe(0);
  });

  it("round-trips through CSV and still imports old CSVs", async () => {
    const app = mk();
    await add(app, "A", { category: "Cables, long" });
    const csv = (await request(app).get("/products.csv").expect(200)).text;
    expect(csv.split("\r\n")[0]).toBe("name,sku,price,quantity,reorderLevel,category");
    const app2 = mk();
    const res = await request(app2).post("/products/import").set("Content-Type", "text/csv").send(csv);
    expect(res.body.imported).toBe(1);
    const list = await request(app2).get("/products?category=cables, long").expect(200);
    expect(list.body.total).toBe(1);
    const old = await request(app2)
      .post("/products/import")
      .set("Content-Type", "text/csv")
      .send("name,sku,price,quantity\nOld,O1,1,1");
    expect(old.body.imported).toBe(1);
  });
});
