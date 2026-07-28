import { Router, type IRouter } from "express";
import { eq, and, gte, asc, inArray } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import {
  AdminListChargersResponse,
  AdminListQueueResponse,
  AdminGetTodaySessionsResponse,
  AdminReleaseChargerParams,
  AdminReleaseChargerResponse,
  AdminRemoveQueueEntryParams,
  AdminRemoveQueueEntryResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import type { AuthRequest } from "../middlewares/requireAuth";
import { processQueue } from "../lib/queue";

const router: IRouter = Router();

// GET /admin/me — returns 200 if the caller is an admin, 403 otherwise
router.get("/admin/me", requireAdmin, (_req, res): void => {
  res.json({ isAdmin: true });
});

// GET /admin/chargers — all chargers with full session info
router.get("/admin/chargers", requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const chargers = await db.select().from(chargersTable).orderBy(chargersTable.id);

  const enriched = await Promise.all(
    chargers.map(async (charger) => {
      if (charger.status === "available") {
        return {
          ...charger,
          currentSessionId: null,
          currentUserId: null,
          currentUserName: null,
        };
      }

      const [session] = await db
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.chargerId, charger.id),
            inArray(chargingSessionsTable.status, ["assigned", "claimed", "checked_in"]),
          ),
        )
        .limit(1);

      return {
        ...charger,
        currentSessionId: session?.id ?? null,
        currentUserId: session?.userId ?? null,
        currentUserName: session?.userName ?? null,
      };
    }),
  );

  res.json(AdminListChargersResponse.parse(enriched));
});

// POST /admin/chargers/:chargerId/release — force-free a stuck charger
router.post("/admin/chargers/:chargerId/release", requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.chargerId) ? req.params.chargerId[0] : req.params.chargerId;
  const params = AdminReleaseChargerParams.safeParse({ chargerId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [charger] = await db
    .select()
    .from(chargersTable)
    .where(eq(chargersTable.id, params.data.chargerId))
    .limit(1);

  if (!charger) {
    res.status(404).json({ error: "Charger not found" });
    return;
  }

  if (charger.status === "available") {
    res.json(AdminReleaseChargerResponse.parse({ success: true, message: "Charger is already free" }));
    return;
  }

  // Forfeit any active sessions on this charger
  await db
    .update(chargingSessionsTable)
    .set({ status: "forfeited", checkedOutAt: new Date() })
    .where(
      and(
        eq(chargingSessionsTable.chargerId, params.data.chargerId),
        inArray(chargingSessionsTable.status, ["assigned", "claimed", "checked_in"]),
      ),
    );

  // Free the charger
  await db
    .update(chargersTable)
    .set({ status: "available" })
    .where(eq(chargersTable.id, params.data.chargerId));

  // Process queue to assign next person
  await processQueue();

  res.json(AdminReleaseChargerResponse.parse({ success: true, message: "Charger released and queue processed" }));
});

// GET /admin/queue — all waiting queue entries
router.get("/admin/queue", requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const entries = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.joinedAt));

  const enriched = entries.map((entry, idx) => ({
    ...entry,
    position: idx + 1,
    estimatedWaitMinutes: idx * 45,
  }));

  res.json(AdminListQueueResponse.parse(enriched));
});

// DELETE /admin/queue/:entryId — remove any queue entry
router.delete("/admin/queue/:entryId", requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.entryId) ? req.params.entryId[0] : req.params.entryId;
  const params = AdminRemoveQueueEntryParams.safeParse({ entryId: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.id, params.data.entryId))
    .limit(1);

  if (!entry) {
    res.status(404).json({ error: "Queue entry not found" });
    return;
  }

  await db
    .update(queueEntriesTable)
    .set({ status: "cancelled" })
    .where(eq(queueEntriesTable.id, params.data.entryId));

  res.json(AdminRemoveQueueEntryResponse.parse({ success: true, message: "Queue entry removed" }));
});

// GET /admin/sessions/today — today's session log
router.get("/admin/sessions/today", requireAdmin, async (req: AuthRequest, res): Promise<void> => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const sessions = await db
    .select()
    .from(chargingSessionsTable)
    .where(gte(chargingSessionsTable.assignedAt, startOfDay))
    .orderBy(asc(chargingSessionsTable.assignedAt));

  const serialized = sessions.map((s) => ({
    ...s,
    claimedAt: s.claimedAt?.toISOString() ?? null,
    checkedInAt: s.checkedInAt?.toISOString() ?? null,
    checkedOutAt: s.checkedOutAt?.toISOString() ?? null,
  }));

  res.json(AdminGetTodaySessionsResponse.parse(serialized));
});

export default router;
