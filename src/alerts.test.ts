import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const add = (
  app: ReturnType<typeof createApp>,
  sku: string,
  quantity: number,
  extra = {},
) =>
  request(app)
    .post("/products")
    .send({ name: sku, sku, price: 1, quantity, ...extra });

describe("low-stock alerts", () => {
  it("uses per-product level, falling back to configured default", async () => {
    const app = createApp({ defaultReorderLevel: 5 });
    await add(app, "A", 5); // default level 5 -> alert
    await add(app, "B", 6); // above default -> no alert
    await add(app, "C", 8, { reorderLevel: 10 }); // custom -> alert
    await add(app, "D", 0, { reorderLevel: 0 }); // at level -> alert
    const res = await request(app).get("/alerts/low-stock").expect(200);
    expect(res.body.map((a: { sku: string }) => a.sku)).toEqual([
      "A",
      "C",
      "D",
    ]);
    expect(res.body[0]).toMatchObject({
      reorderLevel: 5,
      quantity: 5,
      suggestedReorderQuantity: 5,
    });
    expect(res.body[1]).toMatchObject({
      reorderLevel: 10,
      suggestedReorderQuantity: 12,
    });
  });

  it("defaults level to 10 and validates reorderLevel", async () => {
    const app = createApp();
    await add(app, "A", 10);
    expect((await request(app).get("/alerts/low-stock")).body).toHaveLength(1);
    await add(app, "B", 1, { reorderLevel: -1 }).expect(400);
    await add(app, "C", 1, { reorderLevel: 1.5 }).expect(400);
  });

  it("drops out of alerts after restocking", async () => {
    const app = createApp({ defaultReorderLevel: 5 });
    const { body } = await add(app, "A", 1);
    await request(app).patch(`/products/${body.id}/stock`).send({ delta: 10 });
    expect((await request(app).get("/alerts/low-stock")).body).toEqual([]);
  });
});
