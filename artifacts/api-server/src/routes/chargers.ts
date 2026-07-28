import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, chargersTable, chargingSessionsTable } from "@workspace/db";
import { ListChargersResponse } from "@workspace/api-zod";

const ACTIVE_SESSION_STATUSES = ["assigned", "claimed", "checked_in"] as const;

import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/chargers", requireAuth, async (req, res): Promise<void> => {
  const chargers = await db.select().from(chargersTable).orderBy(chargersTable.id);

  // Enrich with current active session info
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

      // Get the latest active session for this charger
      const [session] = await db
        .select()
        .from(chargingSessionsTable)
        .where(
          and(
            eq(chargingSessionsTable.chargerId, charger.id),
            inArray(chargingSessionsTable.status, [...ACTIVE_SESSION_STATUSES]),
          ),
        )
        .orderBy(desc(chargingSessionsTable.assignedAt))
        .limit(1);

      return {
        ...charger,
        currentSessionId: session?.id ?? null,
        currentUserId: null, // not exposed to clients — stripped for privacy
        currentUserName: session?.userName ?? null,
      };
    }),
  );

  res.json(ListChargersResponse.parse(enriched));
});

export default router;
