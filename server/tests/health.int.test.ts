import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok and a db field", async () => {
    const res = await request(createApp()).get("/api/v1/health").expect(200);

    expect(res.body).toMatchObject({ status: "ok" });
    expect(["up", "down", "not_configured"]).toContain(res.body.db);
  });
});
