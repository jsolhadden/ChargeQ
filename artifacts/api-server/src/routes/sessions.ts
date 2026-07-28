import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import {
  ClaimDirectSessionBody,
  ClaimDirectSessionResponse,
  ClaimSessionParams,
  ClaimSessionResponse,
  CheckInSessionParams,
  CheckInSessionResponse,
  CheckOutSessionParams,
  CheckOutSessionResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { processQueue } from "../lib/queue";

const CLAIM_WINDOW_MINUTES = 60;

const router: IRouter = Router();

// POST /sessions/direct — user picks a specific available charger
router.post("/sessions/direct", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const body = ClaimDirectSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = req.userId!;

  const now = new Date();
  const claimDeadline = new Date(now.getTime() + CLAIM_WINDOW_MINUTES * 60 * 1000);

  // Get user display name from Clerk session claims
  const clerkAuth = req as any;
  const firstName = clerkAuth?.auth?.sessionClaims?.given_name ?? "";
  const lastName = clerkAuth?.auth?.sessionClaims?.family_name ?? "";
  const userName = [firstName, lastName].filter(Boolean).join(" ") || "Employee";

  let session: typeof chargingSessionsTable.$inferSelect | null = null;

  try {
    session = await db.transaction(async (tx) => {
      // 1. Block if user already has an active session
      const [activeSession] = await tx
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.userId, userId),
            inArray(chargingSessionsTable.status, ["assigned", "claimed", "checked_in"]),
          ),
        )
        .limit(1);

      if (activeSession) {
        throw Object.assign(new Error("You already have an active charging session"), { status: 400 });
      }

      // 2. Atomically claim the charger: conditional UPDATE where status='available'.
      //    If another request raced us, no row is updated and we return 409.
      const updated = await tx
        .update(chargersTable)
        .set({ status: "assigned" })
        .where(
          and(
            eq(chargersTable.id, body.data.chargerId),
            eq(chargersTable.status, "available"),
          ),
        )
        .returning();

      if (updated.length === 0) {
        // Either charger doesn't exist or it was just taken by someone else
        const [charger] = await tx
          .select()
          .from(chargersTable)
          .where(eq(chargersTable.id, body.data.chargerId))
          .limit(1);

        if (!charger) {
          throw Object.assign(new Error("Charger not found"), { status: 404 });
        }
        throw Object.assign(
          new Error(`${charger.name} is no longer available — someone else just took it`),
          { status: 409 },
        );
      }

      const charger = updated[0];

      // 3. Cancel any waiting queue entry so the user isn't re-assigned by processQueue
      await tx
        .update(queueEntriesTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(queueEntriesTable.userId, userId),
            eq(queueEntriesTable.status, "waiting"),
          ),
        );

      // 4. Create the session
      const [newSession] = await tx
        .insert(chargingSessionsTable)
        .values({
          userId,
          userName,
          chargerId: charger.id,
          chargerName: charger.name,
          status: "assigned",
          claimDeadlineAt: claimDeadline,
        })
        .returning();

      return newSession;
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal server error" });
    return;
  }

  // Process queue in case other chargers are still free
  await processQueue();

  res.status(201).json(ClaimDirectSessionResponse.parse(serializeSession(session)));
});

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
