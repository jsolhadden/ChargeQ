import { Router, type IRouter } from "express";
import { eq, and, inArray, gt } from "drizzle-orm";
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
  CancelSessionParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { processQueue, scheduleQueueNudge } from "../lib/queue";
import { getAuth, clerkClient } from "@clerk/express";

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

  // Derive userName from the email local-part (e.g. "jhadden" from "jhadden@irobot.com").
  // Prefer session claims; fall back to the Clerk API when the email claim is absent.
  let userName = "employee";
  let userEmail = "";
  try {
    const auth = getAuth(req);
    userEmail = (auth as any)?.sessionClaims?.email ?? "";
    if (!userEmail) {
      const clerkUser = await clerkClient.users.getUser(userId);
      userEmail = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    }
    if (userEmail) {
      userName = userEmail.split("@")[0] || "employee";
    }
  } catch {
    // fallback value is fine
  }

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
        .set({ status: "occupied" })
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

      // 4. Create the session — direct-tap skips assigned/claimed and goes straight to checked_in.
      //    claimDeadlineAt is required by the schema but irrelevant for direct sessions; use now.
      const [newSession] = await tx
        .insert(chargingSessionsTable)
        .values({
          userId,
          userName,
          userEmail,
          chargerId: charger.id,
          chargerName: charger.name,
          status: "checked_in",
          claimDeadlineAt: now,
          claimedAt: now,
          checkedInAt: now,
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

  // Schedule 3-hour nudge timer for this session
  if (session.checkedInAt) {
    scheduleQueueNudge(session.id, session.checkedInAt);
  }

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
  if (session.claimDeadlineAt && session.claimDeadlineAt < now) {
    res.status(400).json({ error: "Claim window has expired" });
    return;
  }

  // Skip straight to checked_in — no intermediate "claimed" state.
  // Use a transaction with a conditional update (WHERE status='assigned') so a concurrent
  // expiry sweep that transitions the session away cannot be overwritten.
  let updated: typeof chargingSessionsTable.$inferSelect | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(chargingSessionsTable)
        .set({ status: "checked_in", claimedAt: now, checkedInAt: now })
        .where(
          and(
            eq(chargingSessionsTable.id, session.id),
            eq(chargingSessionsTable.status, "assigned"),
            // Deadline guard inside the transaction — if the expiry sweep fired between
            // our pre-check and now, the row count will be 0 and we return 409.
            gt(chargingSessionsTable.claimDeadlineAt, now),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw Object.assign(new Error("Claim window has expired or session was already processed"), { status: 409 });
      }

      // Mark charger occupied within the same transaction
      await tx
        .update(chargersTable)
        .set({ status: "occupied" })
        .where(eq(chargersTable.id, session.chargerId));

      return rows[0];
    });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
    return;
  }

  // Schedule 3-hour nudge timer now that the session is checked_in
  if (updated.checkedInAt) {
    scheduleQueueNudge(updated.id, updated.checkedInAt);
  }

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

  // Schedule 3-hour nudge timer now that the session is checked_in
  if (updated.checkedInAt) {
    scheduleQueueNudge(updated.id, updated.checkedInAt);
  }

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

// DELETE /sessions/:sessionId/cancel — release an assigned slot before claiming
router.delete("/sessions/:sessionId/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const params = CancelSessionParams.safeParse({ sessionId: raw });
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
    res.status(400).json({ error: `Cannot cancel — session is already ${session.status}` });
    return;
  }

  // Mark session cancelled
  await db
    .update(chargingSessionsTable)
    .set({ status: "cancelled" })
    .where(eq(chargingSessionsTable.id, session.id));

  // Free the charger
  await db
    .update(chargersTable)
    .set({ status: "available" })
    .where(eq(chargersTable.id, session.chargerId));

  // Assign the next person in queue
  await processQueue();

  res.json({ success: true, message: "Reservation cancelled" });
});

export default router;
