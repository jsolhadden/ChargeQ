import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chargersTable = pgTable("chargers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("available"), // available | assigned | occupied
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChargerSchema = createInsertSchema(chargersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCharger = z.infer<typeof insertChargerSchema>;
export type Charger = typeof chargersTable.$inferSelect;
