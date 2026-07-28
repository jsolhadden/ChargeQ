import { getAuth, clerkClient } from "@clerk/express";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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
    const primaryEmail = (
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0]
    )?.emailAddress?.toLowerCase() ?? "";

    const isAdmin =
      role === "admin" ||
      (ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(primaryEmail));

    if (!isAdmin) {
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
