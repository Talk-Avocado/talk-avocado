/// <reference path="./ambient-handlers.d.ts" />
import { test, describe } from "node:test";
import assert from "node:assert";

describe("handlers correlation propagation", () => {
  test("mark-processing returns body with correlationId", async () => {
    const mod = await import("../services/mark-processing/handler.js");
    const result = await mod.handler({
      tenantId: "t1",
      jobId: "j1",
      correlationId: "abc-123",
    });
    assert.strictEqual(result.body.correlationId, "abc-123");
  });

  test("mark-complete returns body with correlationId", async () => {
    const mod = await import("../services/mark-complete/handler.js");
    const result = await mod.handler({
      tenantId: "t1",
      jobId: "j1",
      correlationId: "xyz-789",
    });
    assert.strictEqual(result.body.correlationId, "xyz-789");
  });
});
