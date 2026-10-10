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

describe("movement pagination and filtering", () => {
  async function seeded(n: number) {
    const { app, id } = await setup();
    for (let i = 0; i < n; i++) {
      await request(app)
        .post(`/products/${id}/movements`)
        .send({ type: "in", quantity: 1, reason: `m${i}` })
        .expect(201);
    }
    return { app, url: `/products/${id}/movements` };
  }

  it("defaults to 50 newest-first with X-Total-Count", async () => {
    const { app, url } = await seeded(55);
    const res = await request(app).get(url).expect(200);
    expect(res.body).toHaveLength(50);
    expect(res.body[0].reason).toBe("m54");
    expect(res.headers["x-total-count"]).toBe("55");
  });

  it("applies limit and offset", async () => {
    const { app, url } = await seeded(5);
    const res = await request(app).get(`${url}?limit=2&offset=1`).expect(200);
    expect(res.body.map((m: { reason: string }) => m.reason)).toEqual(["m3", "m2"]);
    expect(res.headers["x-total-count"]).toBe("5");
  });

  it("filters by since and counts after the filter", async () => {
    const { app, url } = await seeded(5);
    const all = (await request(app).get(url)).body as { at: number }[];
    const since = new Date(all[2].at).toISOString();
    const res = await request(app).get(`${url}?since=${since}`).expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.headers["x-total-count"]).toBe("3");
  });

  it.each(["limit=0", "limit=201", "limit=x", "offset=-1", "offset=1.5", "since=nope"])(
    "rejects %s with 400 problem+json",
    async (qs) => {
      const { app, url } = await seeded(1);
      const res = await request(app).get(`${url}?${qs}`).expect(400);
      expect(res.headers["content-type"]).toMatch(/problem\+json/);
    },
  );

  it("still 404s for unknown product", async () => {
    const { app } = await seeded(0);
    await request(app).get("/products/99/movements?limit=5").expect(404);
  });
});
