import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const mk = (apiKey?: string) => createApp({ apiKey, log: () => {} });
const seed = async (app: ReturnType<typeof createApp>) =>
  (
    await request(app)
      .post("/products")
      .send({ name: "Widget", sku: "W-1", price: 2.5, quantity: 4 })
  ).body;

describe("PATCH /products/:id", () => {
  it("updates only supplied fields and leaves stock history alone", async () => {
    const app = mk();
    const p = await seed(app);
    const res = await request(app)
      .patch(`/products/${p.id}`)
      .send({ price: 3, reorderLevel: 7 })
      .expect(200);
    expect(res.body).toEqual({ ...p, price: 3, reorderLevel: 7 });
    const renamed = await request(app)
      .patch(`/products/${p.id}`)
      .send({ name: "  Gadget " })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: "Gadget", price: 3, quantity: 4 });
    const moves = await request(app).get(`/products/${p.id}/movements`).expect(200);
    expect(moves.body).toEqual([]);
    expect((await request(app).get(`/products/${p.id}`)).body.name).toBe("Gadget");
  });

  it("returns 404 for unknown ids", async () => {
    await request(mk()).patch("/products/99").send({ name: "x" }).expect(404);
  });

  it("returns 400 for empty or invalid bodies", async () => {
    const app = mk();
    const p = await seed(app);
    const url = `/products/${p.id}`;
    await request(app).patch(url).send({}).expect(400);
    await request(app).patch(url).send({ price: -1 }).expect(400);
    await request(app).patch(url).send({ name: "" }).expect(400);
    await request(app).patch(url).send({ reorderLevel: 1.5 }).expect(400);
  });

  it("ignores stock and sku fields", async () => {
    const app = mk();
    const p = await seed(app);
    await request(app).patch(`/products/${p.id}`).send({ quantity: 50 }).expect(400);
    await request(app).patch(`/products/${p.id}`).send({ sku: "Z", name: "N" }).expect(400);
    expect((await request(app).get(`/products/${p.id}`)).body.quantity).toBe(4);
  });

  it("requires the API key when configured", async () => {
    const app = mk("secret");
    await request(app).patch("/products/1").send({ name: "x" }).expect(401);
    await request(app).patch("/products/1").set("X-API-Key", "bad").send({ name: "x" }).expect(401);
    await request(app).patch("/products/1").set("X-API-Key", "secret").send({ name: "x" }).expect(404);
  });
});
