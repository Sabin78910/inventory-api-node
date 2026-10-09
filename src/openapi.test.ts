import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

const registeredRoutes = (app: ReturnType<typeof createApp>) => {
  const stack = (app as unknown as { router: { stack: Layer[] } }).router.stack;
  return stack.flatMap((l) =>
    l.route
      ? Object.keys(l.route.methods).map(
          (m) =>
            `${m.toUpperCase()} ${l.route!.path.replace(/:(\w+)/g, "{$1}")}`,
        )
      : [],
  );
};

describe("openapi", () => {
  it("serves the spec at /openapi.json", async () => {
    const res = await request(createApp()).get("/openapi.json").expect(200);
    expect(res.type).toBe("application/json");
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBeTruthy();
  });

  it("documents every route", async () => {
    const app = createApp();
    const spec = (await request(app).get("/openapi.json")).body;
    const documented = Object.entries(spec.paths).flatMap(([p, ops]) =>
      Object.keys(ops as object).map((m) => `${m.toUpperCase()} ${p}`),
    );
    const routes = registeredRoutes(app).filter(
      (r) => r !== "GET /openapi.json" && r !== "GET /",
    );
    expect(routes.length).toBeGreaterThan(10);
    expect(documented.sort()).toEqual(expect.arrayContaining(routes));
  });
});
