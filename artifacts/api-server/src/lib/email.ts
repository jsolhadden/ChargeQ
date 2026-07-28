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

  const deadlineStr = claimDeadline.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

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
