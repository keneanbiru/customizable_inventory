import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError.js";
import type { UserRole } from "../domain/roles.js";

export function requireRoles(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError("Unauthorized", 401));
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      next(new AppError("Forbidden", 403));
      return;
    }
    next();
  };
}
