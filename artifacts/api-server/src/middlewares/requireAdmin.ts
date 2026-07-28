import { getAuth, clerkClient } from "@clerk/express";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth";

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const role = (user.publicMetadata as Record<string, unknown>)?.role;
    if (role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    req.userId = userId;
  } catch {
    res.status(403).json({ error: "Could not verify admin status" });
    return;
  }

  next();
};
