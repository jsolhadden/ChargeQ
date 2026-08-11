import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chargingSessionsTable = pgTable("charging_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userEmail: text("user_email").notNull().default(""),
  chargerId: integer("charger_id").notNull(),
  chargerName: text("charger_name").notNull(),
  status: text("status").notNull().default("assigned"), // assigned | claimed | checked_in | checked_out | forfeited | expired
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  claimDeadlineAt: timestamp("claim_deadline_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  nudgeEmailSentAt: timestamp("nudge_email_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChargingSessionSchema = createInsertSchema(chargingSessionsTable).omit({ id: true, assignedAt: true, createdAt: true, updatedAt: true });
export type InsertChargingSession = z.infer<typeof insertChargingSessionSchema>;
export type ChargingSession = typeof chargingSessionsTable.$inferSelect;
