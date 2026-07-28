import { eq, and, inArray, asc, lt, sql } from "drizzle-orm";
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

    logger.info({ sessionId: session.id, userId: entry.userId, chargerId: charger.id }, "Charger assigned");
  }
}

/**
 * Expires sessions where the claim window has passed without claiming.
 * Expires active sessions left open at end of day.
 * Should be called periodically.
 */
export async function runExpiryCheck(): Promise<void> {
  const now = new Date();

  // Forfeit only sessions where status=assigned AND claimDeadlineAt has passed
  const expiredAssigned = await db
    .select()
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.status, "assigned"),
        lt(chargingSessionsTable.claimDeadlineAt, now),
      ),
    );

  if (expiredAssigned.length > 0) {
    await db
      .update(chargingSessionsTable)
      .set({ status: "forfeited" })
      .where(inArray(chargingSessionsTable.id, expiredAssigned.map((s) => s.id)));

    // Free the chargers
    await db
      .update(chargersTable)
      .set({ status: "available" })
      .where(inArray(chargersTable.id, expiredAssigned.map((s) => s.chargerId)));

    // Update associated queue entries to forfeited
    await db
      .update(queueEntriesTable)
      .set({ status: "forfeited" })
      .where(inArray(queueEntriesTable.sessionId, expiredAssigned.map((s) => s.id)));

    logger.info({ count: expiredAssigned.length }, "Forfeited expired claim sessions");
    await processQueue();
  }

  // End-of-day: expire active sessions and clear waiting queue at 11:55 PM Eastern.
  // Compute Eastern hour without relying on ICU (same DST logic as email.ts).
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
  const isDST = now >= dstStart && now < dstEnd;
  const easternHour = (now.getUTCHours() - (isDST ? 4 : 5) + 24) % 24;
  const easternMinute = now.getUTCMinutes();

  if (easternHour === 23 && easternMinute >= 55) {
    // Expire active sessions
    const staleSessions = await db
      .select()
      .from(chargingSessionsTable)
      .where(inArray(chargingSessionsTable.status, ["checked_in", "claimed"]));

    if (staleSessions.length > 0) {
      await db
        .update(chargingSessionsTable)
        .set({ status: "expired", checkedOutAt: now })
        .where(inArray(chargingSessionsTable.id, staleSessions.map((s) => s.id)));

      await db
        .update(chargersTable)
        .set({ status: "available" })
        .where(inArray(chargersTable.id, staleSessions.map((s) => s.chargerId)));

      logger.info({ count: staleSessions.length }, "End-of-day session expiry");
    }

    // Cancel any remaining waiting queue entries so they don't carry over
    const waitingEntries = await db
      .select()
      .from(queueEntriesTable)
      .where(eq(queueEntriesTable.status, "waiting"));

    if (waitingEntries.length > 0) {
      await db
        .update(queueEntriesTable)
        .set({ status: "cancelled" })
        .where(inArray(queueEntriesTable.id, waitingEntries.map((e) => e.id)));

      logger.info({ count: waitingEntries.length }, "End-of-day queue clear");
    }
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
  // Check for expired claim windows every 2 minutes
  setInterval(() => {
    runExpiryCheck().catch((err) => logger.error({ err }, "Expiry check failed"));
  }, 2 * 60 * 1000);

  logger.info("Background jobs started");
}
