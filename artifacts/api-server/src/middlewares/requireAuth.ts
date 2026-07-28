import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase().trim();

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  userName?: string;
}

export const requireAuth = async (
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

  req.userId = userId;

  if (ALLOWED_DOMAIN) {
    try {
      const user = await clerkClient.users.getUser(userId);
      const isAdmin = (user.publicMetadata as Record<string, unknown>)?.role === "admin";
      const primaryEmail = (
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
        user.emailAddresses[0]
      )?.emailAddress ?? "";

      if (!isAdmin && !primaryEmail.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        res
          .status(403)
          .json({ error: `Access restricted to @${ALLOWED_DOMAIN} accounts` });
        return;
      }

      // Populate for downstream routes that use req.userEmail
      req.userEmail = primaryEmail;
    } catch {
      // Fail closed — can't verify domain
      res.status(403).json({ error: "Could not verify account domain" });
      return;
    }
  }

  next();
};
