import { eq, and, inArray, asc, lt, gt, sql } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import { sendChargerAssignedEmail } from "./email";
import { logger } from "./logger";

const CLAIM_WINDOW_MINUTES = 60;

/**
 * Tries to assign available chargers to the next people in the queue.
 * Should be called after a charger becomes free (checkout, expiry, forfeit).
 */
export async function processQueue(): Promise<void> {
  // Get all available chargers
  const availableChargers = await db
    .select()
    .from(chargersTable)
    .where(eq(chargersTable.status, "available"));

  if (availableChargers.length === 0) return;

  // Get waiting queue entries in FIFO order
  const waitingEntries = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.joinedAt))
    .limit(availableChargers.length);

  if (waitingEntries.length === 0) return;

  for (let i = 0; i < Math.min(availableChargers.length, waitingEntries.length); i++) {
    const charger = availableChargers[i];
    const entry = waitingEntries[i];

    const claimDeadline = new Date(Date.now() + CLAIM_WINDOW_MINUTES * 60 * 1000);

    // Create session
    const [session] = await db.insert(chargingSessionsTable).values({
      userId: entry.userId,
      userName: entry.userName,
      chargerId: charger.id,
      chargerName: charger.name,
      status: "assigned",
      claimDeadlineAt: claimDeadline,
    }).returning();

    // Update charger status
    await db.update(chargersTable)
      .set({ status: "assigned" })
      .where(eq(chargersTable.id, charger.id));

    // Update queue entry
    await db.update(queueEntriesTable)
      .set({ status: "assigned", sessionId: session.id })
      .where(eq(queueEntriesTable.id, entry.id));

    // Send email notification
    try {
      await sendChargerAssignedEmail({
        toEmail: entry.userEmail,
        toName: entry.userName,
        chargerName: charger.name,
        claimDeadline,
      });
    } catch (err) {
      logger.warn({ err, userId: entry.userId }, "Failed to send assignment email");
    }

    // Schedule a one-shot timer to expire this session if the user doesn't claim in time
    scheduleClaimExpiry(session.id, claimDeadline);

    logger.info({ sessionId: session.id, userId: entry.userId, chargerId: charger.id }, "Charger assigned");
  }
}

/**
 * Schedules a one-shot timer that expires a single queue-assigned session when its
 * claim deadline arrives. Uses a conditional UPDATE so it is safe against races:
 * if the user claims before the timer fires, the UPDATE matches 0 rows and no-ops.
 *
 * Call this immediately after creating an assigned session in processQueue, and
 * during startup recovery for any sessions still within their claim window.
 */
export function scheduleClaimExpiry(sessionId: number, claimDeadlineAt: Date): void {
  const delay = Math.max(0, claimDeadlineAt.getTime() - Date.now());

  setTimeout(async () => {
    try {
      // Conditional UPDATE — only forfeits if still 'assigned' AND past deadline.
      // If the user claimed between timer creation and now, 0 rows match → no-op.
      const forfeited = await db
        .update(chargingSessionsTable)
        .set({ status: "forfeited" })
        .where(
          and(
            eq(chargingSessionsTable.id, sessionId),
            eq(chargingSessionsTable.status, "assigned"),
            lt(chargingSessionsTable.claimDeadlineAt, new Date()),
          ),
        )
        .returning();

      if (forfeited.length > 0) {
        const session = forfeited[0];

        await db
          .update(chargersTable)
          .set({ status: "available" })
          .where(eq(chargersTable.id, session.chargerId));

        await db
          .update(queueEntriesTable)
          .set({ status: "forfeited" })
          .where(eq(queueEntriesTable.sessionId, sessionId));

        logger.info({ sessionId, chargerId: session.chargerId }, "Claim window expired — charger freed");
        await processQueue();
      }
    } catch (err) {
      logger.error({ err, sessionId }, "Claim expiry timer failed");
    }
  }, delay);
}

/**
 * Expires sessions where the claim window has passed without claiming.
 * No longer polled on an interval — kept for startup recovery of already-expired
 * sessions that slipped through before the server restarted.
 */
export async function runExpiryCheck(): Promise<void> {
  const now = new Date();

  // Single conditional UPDATE — avoids the select-then-update race where a concurrent
  // claim could land between SELECT and UPDATE, causing a checked_in session to be
  // overwritten as forfeited. Only sessions still in 'assigned' status are forfeited.
  const forfeited = await db
    .update(chargingSessionsTable)
    .set({ status: "forfeited" })
    .where(
      and(
        eq(chargingSessionsTable.status, "assigned"),
        lt(chargingSessionsTable.claimDeadlineAt, now),
      ),
    )
    .returning();

  if (forfeited.length > 0) {
    // Free only the chargers that were actually forfeited (not ones already claimed)
    await db
      .update(chargersTable)
      .set({ status: "available" })
      .where(inArray(chargersTable.id, forfeited.map((s) => s.chargerId)));

    // Update associated queue entries to forfeited
    await db
      .update(queueEntriesTable)
      .set({ status: "forfeited" })
      .where(inArray(queueEntriesTable.sessionId, forfeited.map((s) => s.id)));

    logger.info({ count: forfeited.length }, "Forfeited expired claim sessions");
    await processQueue();
  }
}

/**
 * Returns the UTC timestamp for the start of "today" in Eastern time.
 * Uses manual DST arithmetic (2nd Sunday Mar → 1st Sunday Nov) so it works
 * without ICU data in production.
 *
 * Two-step to handle DST transition days correctly:
 *  1. Use the *current* DST offset to determine today's ET date (avoids the
 *     1-hour window around midnight where a fixed -5h approximation picks the
 *     wrong calendar day during EDT).
 *  2. Then determine the DST offset *at midnight* of that ET date — which can
 *     differ from the current offset on spring-forward / fall-back days.
 */
function getStartOfTodayET(now: Date): Date {
  const getNthSundayUTC = (year: number, month: number, n: number): Date => {
    const d = new Date(Date.UTC(year, month, 1));
    d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7);
    return d;
  };
  const yr = now.getUTCFullYear();
  const dstStart = getNthSundayUTC(yr, 2, 2);
  dstStart.setUTCHours(7); // 2 AM EST = 7 AM UTC
  const dstEnd = getNthSundayUTC(yr, 10, 1);
  dstEnd.setUTCHours(6); // 2 AM EDT = 6 AM UTC

  // Step 1: determine today's ET calendar date using the current offset.
  const isDSTNow = now >= dstStart && now < dstEnd;
  const offsetNow = isDSTNow ? 4 : 5;
  const nowET = new Date(now.getTime() - offsetNow * 60 * 60 * 1000);
  const year = nowET.getUTCFullYear();
  const month = nowET.getUTCMonth();
  const day = nowET.getUTCDate();

  // Step 2: determine the DST offset at midnight of that ET date.
  //   If midnight (04:00 UTC, i.e. EDT) falls inside the DST window → EDT offset.
  //   Otherwise → EST offset.
  //   DST start day: midnight = 05:00 UTC (still EST; 2 AM transition is at 07:00 UTC).
  //   DST end day:   midnight = 04:00 UTC (still EDT; 2 AM transition is at 06:00 UTC).
  const midnightEDT = new Date(Date.UTC(year, month, day, 4));
  const isDSTAtMidnight = midnightEDT >= dstStart && midnightEDT < dstEnd;
  return isDSTAtMidnight ? midnightEDT : new Date(Date.UTC(year, month, day, 5));
}

/**
 * Expires any sessions and queue entries that belong to a previous calendar day
 * in Eastern time. Covers checked_in, claimed, and assigned sessions — including
 * admin-placed ones. Chargers are freed and processQueue is triggered so the
 * next morning starts with a clean slate automatically.
 *
 * Runs hourly (and once at startup). Robust against server restarts that miss
 * the old 11:55 PM window.
 */
export async function runOvernightSweep(): Promise<void> {
  const now = new Date();
  const startOfTodayET = getStartOfTodayET(now);

  // Find any active sessions created before the start of today ET
  const staleSessions = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        inArray(chargingSessionsTable.status, ["checked_in", "claimed", "assigned"]),
        lt(chargingSessionsTable.createdAt, startOfTodayET),
      ),
    );

  if (staleSessions.length > 0) {
    await db
      .update(chargingSessionsTable)
      .set({ status: "expired", checkedOutAt: now })
      .where(inArray(chargingSessionsTable.id, staleSessions.map((s) => s.id)));

    await db
      .update(chargersTable)
      .set({ status: "available" })
      .where(inArray(chargersTable.id, staleSessions.map((s) => s.chargerId)));

    // Also mark any associated queue entries expired
    await db
      .update(queueEntriesTable)
      .set({ status: "cancelled" })
      .where(inArray(queueEntriesTable.sessionId, staleSessions.map((s) => s.id)));

    logger.info({ count: staleSessions.length, startOfTodayET }, "Overnight sweep: expired stale sessions");
    await processQueue();
  }

  // Cancel any waiting queue entries from a previous day
  const staleQueue = await db
    .select()
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.status, "waiting"),
        lt(queueEntriesTable.joinedAt, startOfTodayET),
      ),
    );

  if (staleQueue.length > 0) {
    await db
      .update(queueEntriesTable)
      .set({ status: "cancelled" })
      .where(inArray(queueEntriesTable.id, staleQueue.map((e) => e.id)));

    logger.info({ count: staleQueue.length }, "Overnight sweep: cancelled stale queue entries");
  }
}

/**
 * Idempotently ensures the two office chargers exist in the DB.
 * Safe to run on every startup — uses ON CONFLICT DO NOTHING.
 */
export async function seedChargers(): Promise<void> {
  await db
    .insert(chargersTable)
    .values([
      { id: 1, name: "Left Charger", status: "available" },
      { id: 2, name: "Right Charger", status: "available" },
    ])
    .onConflictDoUpdate({
      target: chargersTable.id,
      set: { name: sql`EXCLUDED.name` },
    });
  logger.info("Chargers seeded (idempotent)");
}

export function startBackgroundJobs(): void {
  // Startup recovery: schedule timers for any assigned sessions still within their
  // claim window, and immediately expire any that already missed their deadline.
  // This replaces the old 2-minute polling interval — the DB is now only queried
  // at this single startup point and when a new session is created via processQueue.
  (async () => {
    try {
      const now = new Date();

      // Re-arm timers for sessions still within their window
      const pending = await db
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.status, "assigned"),
            gt(chargingSessionsTable.claimDeadlineAt, now),
          ),
        );

      for (const session of pending) {
        scheduleClaimExpiry(session.id, session.claimDeadlineAt);
      }

      if (pending.length > 0) {
        logger.info({ count: pending.length }, "Re-armed claim expiry timers after restart");
      }

      // Immediately expire anything already past its deadline
      await runExpiryCheck();
    } catch (err) {
      logger.error({ err }, "Startup claim recovery failed");
    }
  })();

  // Sweep for sessions left open from a previous day — run once at startup
  // then every hour. Robust against server restarts that miss the old midnight window.
  runOvernightSweep().catch((err) => logger.error({ err }, "Overnight sweep (startup) failed"));
  setInterval(() => {
    runOvernightSweep().catch((err) => logger.error({ err }, "Overnight sweep failed"));
  }, 60 * 60 * 1000);

  logger.info("Background jobs started");
}
