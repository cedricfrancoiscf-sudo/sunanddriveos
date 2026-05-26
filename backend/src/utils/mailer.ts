import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!process.env.SMTP_USER) {
    console.warn('[Mailer] SMTP_USER non défini — email non envoyé :', opts.subject);
    return;
  }
  await transporter.sendMail({
    from: opts.from ?? `"SunanddriveOS" <${process.env.SMTP_USER}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

export async function sendInvitationEmail(
  to: string,
  name: string,
  inviteUrl: string,
  companyName: string,
): Promise<void> {
  if (!process.env.SMTP_USER) {
    console.warn('[Mailer] SMTP_USER non défini — email d\'invitation non envoyé');
    return;
  }

  await transporter.sendMail({
    from: `"${companyName}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Invitation à rejoindre ${companyName}`,
    html: `
      <p>Bonjour ${name},</p>
      <p>Vous avez été invité(e) à rejoindre <strong>${companyName}</strong> sur SunanddriveOS.</p>
      <p>
        <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#01696e;color:#fff;text-decoration:none;border-radius:6px;">
          Accepter l'invitation
        </a>
      </p>
      <p>Ce lien est valable 7 jours.</p>
    `,
  });
}
