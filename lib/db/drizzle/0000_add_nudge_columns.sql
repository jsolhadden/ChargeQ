-- Add user_email and nudge_email_sent_at columns to charging_sessions.
-- user_email stores the address for nudge emails (populated on session creation).
-- nudge_email_sent_at prevents duplicate nudge sends (set atomically when email fires).
ALTER TABLE "charging_sessions" ADD COLUMN IF NOT EXISTS "user_email" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN IF NOT EXISTS "nudge_email_sent_at" timestamp with time zone;
