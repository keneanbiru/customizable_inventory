import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/AppError.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

function miniAppWith(handler: express.RequestHandler) {
  const app = express();
  app.get("/t", handler);
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("serializes AppError as JSON with status and code", async () => {
    const app = miniAppWith((_req, _res, next) => {
      next(new AppError("Test application error", 418, "TEST"));
    });

    const res = await request(app).get("/t").expect(418);
    expect(res.body).toEqual({
      error: {
        message: "Test application error",
        code: "TEST",
      },
    });
  });

  it("returns 500 for unknown errors", async () => {
    const app = miniAppWith((_req, _res, next) => {
      next(new Error("Unexpected boom"));
    });

    const res = await request(app).get("/t").expect(500);
    expect(res.body.error).toHaveProperty("message");
  });
});
