import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { metadataRouter } from "./routes/metadata.js";
import { productsRouter } from "./routes/products.js";
import { settingsRouter } from "./routes/settings.js";
import { suppliersRouter, warehousesRouter } from "./routes/suppliersWarehouses.js";
import { systemLogsRouter } from "./routes/systemLogs.js";
import { usersRouter } from "./routes/users.js";
import { overviewRouter } from "./routes/overview.js";
import { alertsRouter } from "./routes/alerts.js";

export function createApp() {
  const app = express();

  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/system-logs", systemLogsRouter);
  app.use("/api/v1", metadataRouter);
  app.use("/api/v1", settingsRouter);
  app.use("/api/v1/products", productsRouter);
  app.use("/api/v1/suppliers", suppliersRouter);
  app.use("/api/v1/warehouses", warehousesRouter);
  app.use("/api/v1", overviewRouter);
  app.use("/api/v1", alertsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { message: "Not found" } });
  });

  app.use(errorHandler);

  return app;
}
