import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

async function setup() {
  let t = 1000;
  const app = createApp({ now: () => t++ });
  const { body } = await request(app)
    .post("/products")
    .send({ name: "Shawl", sku: "S-1", price: 10, quantity: 5 });
  return { app, id: body.id as number };
}

describe("stock movements", () => {
  it("records in/out/adjust and lists newest first", async () => {
    const { app, id } = await setup();
    const url = `/products/${id}/movements`;
    await request(app)
      .post(url)
      .send({ type: "in", quantity: 5, reason: "restock", reference: "PO-1" })
      .expect(201);
    await request(app)
      .post(url)
      .send({ type: "out", quantity: 3, reason: "sale" })
      .expect(201);
    const adj = await request(app)
      .post(url)
      .send({ type: "adjust", quantity: 4, reason: "count" })
      .expect(201);
    expect(adj.body).toMatchObject({ delta: -3, balance: 4 });
    expect((await request(app).get(`/products/${id}`)).body.quantity).toBe(4);
    const list = await request(app).get(url).expect(200);
    expect(list.body.map((m: { type: string }) => m.type)).toEqual([
      "adjust",
      "out",
      "in",
    ]);
    expect(list.body[2].reference).toBe("PO-1");
  });

  it("rejects negative stock and bad input with 400", async () => {
    const { app, id } = await setup();
    const url = `/products/${id}/movements`;
    await request(app)
      .post(url)
      .send({ type: "out", quantity: 6, reason: "sale" })
      .expect(400);
    await request(app)
      .post(url)
      .send({ type: "bogus", quantity: 1, reason: "x" })
      .expect(400);
    await request(app).post(url).send({ type: "in", quantity: 1 }).expect(400);
    expect((await request(app).get(url)).body).toEqual([]);
  });

  it("404s for unknown product", async () => {
    const { app } = await setup();
    await request(app).get("/products/99/movements").expect(404);
    await request(app)
      .post("/products/99/movements")
      .send({ type: "in", quantity: 1, reason: "x" })
      .expect(404);
  });

  it("PATCH stock records a movement", async () => {
    const { app, id } = await setup();
    await request(app)
      .patch(`/products/${id}/stock`)
      .send({ delta: -2 })
      .expect(200);
    const list = await request(app).get(`/products/${id}/movements`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ type: "out", delta: -2, balance: 3 });
  });
});
