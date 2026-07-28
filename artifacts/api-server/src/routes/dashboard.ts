import { Router, type IRouter } from "express";
import { eq, and, count, gte } from "drizzle-orm";
import { db, chargersTable, queueEntriesTable, chargingSessionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const chargers = await db.select().from(chargersTable);

  const available = chargers.filter((c) => c.status === "available").length;
  const occupied = chargers.filter((c) => c.status === "occupied").length;
  const assigned = chargers.filter((c) => c.status === "assigned").length;

  const [queueResult] = await db
    .select({ count: count() })
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"));

  const queueLength = queueResult?.count ?? 0;

  // Today's completed sessions
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [completedResult] = await db
    .select({ count: count() })
    .from(chargingSessionsTable)
    .where(
      and(
        eq(chargingSessionsTable.status, "checked_out"),
        gte(chargingSessionsTable.checkedOutAt, startOfDay),
      ),
    );

  const todayCompleted = completedResult?.count ?? 0;

  // Rough average wait: queue length * 45 min per charger; guard against zero chargers
  const avgWait =
    queueLength > 0 && chargers.length > 0
      ? Math.ceil((Number(queueLength) * 45) / chargers.length)
      : 0;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalChargers: chargers.length,
      availableChargers: available,
      occupiedChargers: occupied,
      assignedChargers: assigned,
      queueLength: Number(queueLength),
      averageWaitMinutes: avgWait,
      todayCompletedSessions: Number(todayCompleted),
    }),
  );
});

export default router;
