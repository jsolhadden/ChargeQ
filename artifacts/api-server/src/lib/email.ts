import { logger } from "./logger";

interface AssignmentEmailParams {
  toEmail: string;
  toName: string;
  chargerName: string;
  claimDeadline: Date;
}

export async function sendChargerAssignedEmail(params: AssignmentEmailParams): Promise<void> {
  const { toEmail, toName, chargerName, claimDeadline } = params;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logger.info({ toEmail }, "RESEND_API_KEY not set, skipping email");
    return;
  }

  // Compute Eastern time without relying on ICU timezone data (unavailable in prod).
  // DST: UTC-4 (EDT) from 2nd Sunday in March 2am → 1st Sunday in November 2am.
  const getNthSundayUTC = (year: number, month: number, n: number): Date => {
    const d = new Date(Date.UTC(year, month, 1));
    d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7);
    return d;
  };
  const yr = claimDeadline.getUTCFullYear();
  const dstStart = getNthSundayUTC(yr, 2, 2); // 2nd Sun March
  dstStart.setUTCHours(7); // 2 AM EST = 7 AM UTC
  const dstEnd = getNthSundayUTC(yr, 10, 1); // 1st Sun November
  dstEnd.setUTCHours(6); // 2 AM EDT = 6 AM UTC
  const isDST = claimDeadline >= dstStart && claimDeadline < dstEnd;
  const easternMs = claimDeadline.getTime() - (isDST ? 4 : 5) * 3600_000;
  const et = new Date(easternMs);
  const h = et.getUTCHours();
  const m = et.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const deadlineStr = `${h12}:${m} ${ampm} ${isDST ? "EDT" : "EST"}`;

  const { Resend } = await import("resend");
  const resend = new Resend(resendKey);

  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  await resend.emails.send({
    from: `EV Charger Waitlist <${fromAddress}>`,
    to: toEmail,
    subject: `Your EV charger spot is ready — claim by ${deadlineStr}`,
    html: `
      <p>Hi ${toName},</p>
      <p>Your spot at <strong>${chargerName}</strong> is now available!</p>
      <p>You have until <strong>${deadlineStr}</strong> (60 minutes) to claim it in the app.</p>
      <p>Open the EV Charger Waitlist app, tap <strong>Claim</strong>, then head to the lot and tap <strong>Check In</strong> once you're plugged in.</p>
      <p>If you don't claim in time, your spot will be passed to the next person in line.</p>
      <br/>
      <p>— EV Charger Waitlist</p>
    `,
  });

  logger.info({ toEmail, chargerName }, "Assignment email sent");
}
