import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const sample = {
  name: "Pashmina Shawl",
  sku: "PS-01",
  price: 2500,
  quantity: 10,
};

describe("inventory api", () => {
  it("health check", async () => {
    await request(createApp()).get("/health").expect(200, { status: "ok" });
  });

  it("creates, lists and updates stock", async () => {
    const app = createApp();
    const { body } = await request(app)
      .post("/products")
      .send(sample)
      .expect(201);
    await request(app).post("/products").send(sample).expect(409);
    await request(app)
      .patch(`/products/${body.id}/stock`)
      .send({ delta: -8 })
      .expect(200);
    const low = await request(app).get("/products?lowStock=2").expect(200);
    expect(low.body.items).toHaveLength(1);
    expect(low.body.total).toBe(1);
    await request(app)
      .patch(`/products/${body.id}/stock`)
      .send({ delta: -5 })
      .expect(422);
    await request(app).delete(`/products/${body.id}`).expect(204);
    await request(app).get(`/products/${body.id}`).expect(404);
  });

  it("validates input", async () => {
    await request(createApp())
      .post("/products")
      .send({ name: "", price: -1 })
      .expect(400);
  });

  describe("pagination", () => {
    async function seed(n: number) {
      const app = createApp();
      for (let i = 1; i <= n; i++) {
        await request(app)
          .post("/products")
          .send({ ...sample, sku: `S-${i}` })
          .expect(201);
      }
      return app;
    }

    it("defaults to limit 20 and offset 0 with total", async () => {
      const app = await seed(25);
      const { body } = await request(app).get("/products").expect(200);
      expect(body.items).toHaveLength(20);
      expect(body).toMatchObject({ total: 25, limit: 20, offset: 0 });
    });

    it("applies limit and offset", async () => {
      const app = await seed(5);
      const { body } = await request(app)
        .get("/products?limit=2&offset=4")
        .expect(200);
      expect(body.items.map((p: { sku: string }) => p.sku)).toEqual(["S-5"]);
      expect(body.total).toBe(5);
    });

    it("total reflects lowStock filter", async () => {
      const app = await seed(3);
      const { body } = await request(app)
        .get("/products?lowStock=5&limit=1")
        .expect(200);
      expect(body).toMatchObject({ total: 0, items: [] });
    });

    it.each(["limit=0", "limit=101", "limit=abc", "offset=-1", "offset=1.5"])(
      "rejects %s",
      async (q) => {
        await request(createApp()).get(`/products?${q}`).expect(400);
      },
    );

    it("accepts max limit 100", async () => {
      await request(createApp()).get("/products?limit=100").expect(200);
    });
  });
  describe("search", () => {
    async function seedSearch() {
      const app = createApp();
      for (const [name, sku] of [
        ["Pashmina Shawl", "PS-01"],
        ["Wool Hat", "WH-02"],
        ["Silk Scarf", "ps-03"],
      ] as const) {
        await request(app)
          .post("/products")
          .send({ name, sku, price: 1, quantity: 1 })
          .expect(201);
      }
      return app;
    }
    const skus = (r: { body: { items: { sku: string }[] } }) =>
      r.body.items.map((p) => p.sku);

    it("matches name case-insensitively", async () => {
      const res = await request(await seedSearch())
        .get("/products?q=WOOL")
        .expect(200);
      expect(skus(res)).toEqual(["WH-02"]);
      expect(res.body.total).toBe(1);
    });

    it("matches sku case-insensitively", async () => {
      const res = await request(await seedSearch())
        .get("/products?q=Ps-0")
        .expect(200);
      expect(skus(res)).toEqual(["PS-01", "ps-03"]);
    });

    it("returns empty for no match and all for empty q", async () => {
      const app = await seedSearch();
      const none = await request(app).get("/products?q=zzz").expect(200);
      expect(none.body).toMatchObject({ total: 0, items: [] });
      const all = await request(app).get("/products?q=").expect(200);
      expect(all.body.total).toBe(3);
    });
  });
  describe("sorting", () => {
    async function seedSorted() {
      const app = createApp();
      for (const [name, sku, price] of [
        ["Banana", "B", 5],
        ["Apple", "A", 20],
        ["Cherry", "C", 10],
      ] as const) {
        await request(app)
          .post("/products")
          .send({ name, sku, price, quantity: 1 })
          .expect(201);
      }
      return app;
    }
    const names = (r: { body: { items: { name: string }[] } }) =>
      r.body.items.map((p) => p.name);

    it("sorts by price asc by default order", async () => {
      const res = await request(await seedSorted())
        .get("/products?sort=price")
        .expect(200);
      expect(names(res)).toEqual(["Banana", "Cherry", "Apple"]);
    });

    it("sorts by price desc", async () => {
      const res = await request(await seedSorted())
        .get("/products?sort=price&order=desc")
        .expect(200);
      expect(names(res)).toEqual(["Apple", "Cherry", "Banana"]);
    });

    it("sorts by name asc and desc", async () => {
      const app = await seedSorted();
      expect(
        names(
          await request(app).get("/products?sort=name&order=asc").expect(200),
        ),
      ).toEqual(["Apple", "Banana", "Cherry"]);
      expect(
        names(
          await request(app).get("/products?sort=name&order=desc").expect(200),
        ),
      ).toEqual(["Cherry", "Banana", "Apple"]);
    });

    it("rejects invalid sort or order", async () => {
      const app = await seedSorted();
      await request(app).get("/products?sort=sku").expect(400);
      await request(app).get("/products?sort=price&order=up").expect(400);
    });
  });
});
