import { Router, type IRouter } from "express";
import { eq, and, asc, inArray } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import {
  ListQueueResponse,
  JoinQueueResponse,
  GetMyQueueEntryResponse,
  LeaveQueueParams,
  LeaveQueueResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { processQueue } from "../lib/queue";
import { getAuth, clerkClient } from "@clerk/express";

const router: IRouter = Router();

const AVG_SESSION_MINUTES = 45; // rough estimate per session

router.get("/queue", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const entries = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.joinedAt));

  const enriched = entries.map((entry, idx) => ({
    ...entry,
    position: idx + 1,
    sessionId: entry.sessionId ?? null,
    estimatedWaitMinutes: idx * AVG_SESSION_MINUTES,
  }));

  res.json(ListQueueResponse.parse(enriched));
});

router.get("/queue/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  // Check for active session first
  const [activeSession] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.userId, userId),
        eq(chargingSessionsTable.status, "assigned"),
      ),
    )
    .limit(1);

  if (activeSession) {
    const now = new Date();
    const msLeft = activeSession.claimDeadlineAt.getTime() - now.getTime();
    const minutesLeft = Math.max(0, Math.ceil(msLeft / 60000));

    const sessionData = {
      ...activeSession,
      claimedAt: activeSession.claimedAt?.toISOString() ?? null,
      checkedInAt: activeSession.checkedInAt?.toISOString() ?? null,
      checkedOutAt: activeSession.checkedOutAt?.toISOString() ?? null,
      minutesRemainingToClaim: minutesLeft,
    };

    res.json(
      GetMyQueueEntryResponse.parse({
        state: "assigned",
        session: sessionData,
        queueEntry: null,
      }),
    );
    return;
  }

  // Check for claimed/checked_in session
  const [claimedSession] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.userId, userId),
        eq(chargingSessionsTable.status, "claimed"),
      ),
    )
    .limit(1);

  if (claimedSession) {
    const sessionData = {
      ...claimedSession,
      claimedAt: claimedSession.claimedAt?.toISOString() ?? null,
      checkedInAt: claimedSession.checkedInAt?.toISOString() ?? null,
      checkedOutAt: claimedSession.checkedOutAt?.toISOString() ?? null,
      minutesRemainingToClaim: null,
    };
    res.json(GetMyQueueEntryResponse.parse({ state: "assigned", session: sessionData, queueEntry: null }));
    return;
  }

  const [checkedInSession] = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.userId, userId),
        eq(chargingSessionsTable.status, "checked_in"),
      ),
    )
    .limit(1);

  if (checkedInSession) {
    const sessionData = {
      ...checkedInSession,
      claimedAt: checkedInSession.claimedAt?.toISOString() ?? null,
      checkedInAt: checkedInSession.checkedInAt?.toISOString() ?? null,
      checkedOutAt: checkedInSession.checkedOutAt?.toISOString() ?? null,
      minutesRemainingToClaim: null,
    };
    res.json(GetMyQueueEntryResponse.parse({ state: "checked_in", session: sessionData, queueEntry: null }));
    return;
  }

  // Check queue entry
  const allWaiting = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.joinedAt));

  const myIdx = allWaiting.findIndex((e) => e.userId === userId);

  if (myIdx >= 0) {
    const entry = allWaiting[myIdx];
    const enriched = {
      ...entry,
      position: myIdx + 1,
      sessionId: entry.sessionId ?? null,
      estimatedWaitMinutes: myIdx * AVG_SESSION_MINUTES,
    };
    res.json(GetMyQueueEntryResponse.parse({ state: "waiting", queueEntry: enriched, session: null }));
    return;
  }

  res.json(GetMyQueueEntryResponse.parse({ state: "not_in_queue", queueEntry: null, session: null }));
});

router.post("/queue", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  // Get user details from Clerk — prefer session claims (fast), fall back to
  // the Clerk API when the email claim is absent (e.g. production tokens).
  let userName = "Employee";
  let userEmail = "";
  try {
    const auth = getAuth(req);
    const firstName = (auth as any)?.sessionClaims?.given_name ?? "";
    const lastName = (auth as any)?.sessionClaims?.family_name ?? "";
    const emailFromClaim = (auth as any)?.sessionClaims?.email ?? "";
    userName = [firstName, lastName].filter(Boolean).join(" ") || "Employee";
    userEmail = emailFromClaim;

    // If session claims didn't carry the email, fetch it from the Clerk API
    if (!userEmail) {
      const clerkUser = await clerkClient.users.getUser(userId);
      userEmail = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      if (!userName || userName === "Employee") {
        userName =
          [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
          "Employee";
      }
    }
  } catch {
    // fallback values are fine
  }

  // Check already in queue
  const [existing] = await db
    .select()
    .from(queueEntriesTable)
    .where(and(eq(queueEntriesTable.userId, userId), eq(queueEntriesTable.status, "waiting")))
    .limit(1);

  if (existing) {
    res.status(400).json({ error: "Already in queue" });
    return;
  }

  // Block if user already has an active session (assigned, claimed, or checked_in)
  const [activeSession] = await db
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
    res.status(400).json({ error: "Already have an active charging session" });
    return;
  }

  // Insert queue entry
  const [entry] = await db
    .insert(queueEntriesTable)
    .values({ userId, userName, userEmail, status: "waiting" })
    .returning();

  // Try to assign immediately if a charger is available
  await processQueue();

  // Re-fetch to get current state
  const allWaiting = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.joinedAt));

  const myIdx = allWaiting.findIndex((e) => e.id === entry.id);
  const position = myIdx >= 0 ? myIdx + 1 : 1;

  const result = {
    ...entry,
    position,
    sessionId: entry.sessionId ?? null,
    estimatedWaitMinutes: Math.max(0, (position - 1)) * AVG_SESSION_MINUTES,
  };

  res.status(201).json(JoinQueueResponse.parse(result));
});

router.delete("/queue/:entryId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.entryId) ? req.params.entryId[0] : req.params.entryId;
  const params = LeaveQueueParams.safeParse({ entryId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .select()
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.id, params.data.entryId),
        eq(queueEntriesTable.userId, req.userId!),
      ),
    )
    .limit(1);

  if (!entry) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  if (entry.status !== "waiting") {
    res.status(400).json({ error: "Cannot leave queue — entry is not in waiting state" });
    return;
  }

  await db
    .update(queueEntriesTable)
    .set({ status: "cancelled" })
    .where(eq(queueEntriesTable.id, entry.id));

  res.json(LeaveQueueResponse.parse({ success: true, message: "Left queue" }));
});

export default router;
