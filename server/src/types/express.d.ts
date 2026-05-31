import type { UserRole } from "../domain/roles.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        role: UserRole;
      };
    }
  }
}

export {};
