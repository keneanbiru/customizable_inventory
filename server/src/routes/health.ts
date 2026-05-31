import { Router } from "express";
import { checkDatabase } from "../db/checkDatabase.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res, next) => {
  try {
    const db = await checkDatabase();
    res.status(200).json({
      status: "ok",
      db,
    });
  } catch (err) {
    next(err);
  }
});
