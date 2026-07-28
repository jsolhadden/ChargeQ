import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import {
  ClaimSessionParams,
  ClaimSessionResponse,
  CheckInSessionParams,
  CheckInSessionResponse,
  CheckOutSessionParams,
  CheckOutSessionResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { processQueue } from "../lib/queue";

const router: IRouter = Router();

function serializeSession(session: typeof chargingSessionsTable.$inferSelect) {
  const now = new Date();
  const msLeft = session.claimDeadlineAt
    ? session.claimDeadlineAt.getTime() - now.getTime()
    : 0;
  const minutesLeft =
    session.status === "assigned"
      ? Math.max(0, Math.ceil(msLeft / 60000))
      : null;

  return {
    ...session,
    claimedAt: session.claimedAt?.toISOString() ?? null,
    checkedInAt: session.checkedInAt?.toISOString() ?? null,
    checkedOutAt: session.checkedOutAt?.toISOString() ?? null,
    minutesRemainingToClaim: minutesLeft,
  };
}

router.post("/sessions/:sessionId/claim", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = ClaimSessionParams.safeParse({ sessionId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.id, params.data.sessionId),
        eq(chargingSessionsTable.userId, req.userId!),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status !== "assigned") {
    res.status(400).json({ error: `Cannot claim — session status is ${session.status}` });
    return;
  }

  const now = new Date();
  if (session.claimDeadlineAt < now) {
    res.status(400).json({ error: "Claim window has expired" });
    return;
  }

  const [updated] = await db
    .update(chargingSessionsTable)
    .set({ status: "claimed", claimedAt: now })
    .where(eq(chargingSessionsTable.id, session.id))
    .returning();

  res.json(ClaimSessionResponse.parse(serializeSession(updated)));
});

router.post("/sessions/:sessionId/checkin", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = CheckInSessionParams.safeParse({ sessionId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.id, params.data.sessionId),
        eq(chargingSessionsTable.userId, req.userId!),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!["assigned", "claimed"].includes(session.status)) {
    res.status(400).json({ error: `Cannot check in — session status is ${session.status}` });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(chargingSessionsTable)
    .set({
      status: "checked_in",
      claimedAt: session.claimedAt ?? now,
      checkedInAt: now,
    })
    .where(eq(chargingSessionsTable.id, session.id))
    .returning();

  // Update charger to occupied
  await db
    .update(chargersTable)
    .set({ status: "occupied" })
    .where(eq(chargersTable.id, session.chargerId));

  res.json(CheckInSessionResponse.parse(serializeSession(updated)));
});

router.post("/sessions/:sessionId/checkout", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = CheckOutSessionParams.safeParse({ sessionId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.id, params.data.sessionId),
        eq(chargingSessionsTable.userId, req.userId!),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!["checked_in", "claimed"].includes(session.status)) {
    res.status(400).json({ error: `Cannot check out — session status is ${session.status}` });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(chargingSessionsTable)
    .set({ status: "checked_out", checkedOutAt: now })
    .where(eq(chargingSessionsTable.id, session.id))
    .returning();

  // Free the charger
  await db
    .update(chargersTable)
    .set({ status: "available" })
    .where(eq(chargersTable.id, session.chargerId));

  // Process queue to assign next person
  await processQueue();

  res.json(CheckOutSessionResponse.parse(serializeSession(updated)));
});

export default router;
