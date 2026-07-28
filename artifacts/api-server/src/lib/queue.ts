import { eq, and, inArray, asc, lt } from "drizzle-orm";
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

  // End-of-day: expire checked_in/claimed sessions if past 11:55 PM
  if (now.getHours() === 23 && now.getMinutes() >= 55) {
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
      await processQueue();
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
      { id: 1, name: "Charger A", status: "available" },
      { id: 2, name: "Charger B", status: "available" },
    ])
    .onConflictDoNothing();
  logger.info("Chargers seeded (idempotent)");
}

export function startBackgroundJobs(): void {
  // Check for expired claim windows every 2 minutes
  setInterval(() => {
    runExpiryCheck().catch((err) => logger.error({ err }, "Expiry check failed"));
  }, 2 * 60 * 1000);

  logger.info("Background jobs started");
}
