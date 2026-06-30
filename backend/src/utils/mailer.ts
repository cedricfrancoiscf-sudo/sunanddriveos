import { Resend } from 'resend';
import { welcomeEmailHtml, invitationEmailHtml, deactivationEmailHtml } from '../modules/email/templates';

function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM_DEFAULT = process.env.RESEND_FROM ?? 'SunanddriveOS <noreply@sunanddrive.com>';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Mailer] RESEND_API_KEY non défini — email non envoyé :', opts.subject);
    return;
  }
  await getResend().emails.send({
    from: opts.from ?? FROM_DEFAULT,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

export async function sendAlertEmail(opts: {
  alertEmails: string[];
  subject: string;
  html: string;
  senderName?: string;
  replyToEmail?: string;
}): Promise<void> {
  if (!opts.alertEmails.length) {
    console.warn('[Mailer] sendAlertEmail — aucun destinataire configuré');
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Mailer] RESEND_API_KEY non défini — alerte non envoyée :', opts.subject);
    return;
  }
  const fromName = opts.senderName ?? 'SunanddriveOS';
  const fromAddr = process.env.RESEND_FROM ?? 'noreply@sunanddrive.com';
  await getResend().emails.send({
    from: `${fromName} <${fromAddr}>`,
    to: opts.alertEmails,
    replyTo: opts.replyToEmail ?? undefined,
    subject: opts.subject,
    html: opts.html,
  });
}

export async function sendWelcomeEmail(
  to: string,
  firstName: string,
  companyName: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Mailer] RESEND_API_KEY non défini — email de bienvenue non envoyé');
    return;
  }
  await getResend().emails.send({
    from: FROM_DEFAULT,
    to,
    subject: 'Bienvenue sur SunanddriveOS 🚗',
    html: welcomeEmailHtml(firstName, companyName),
  });
}

export async function sendInvitationEmail(
  to: string,
  inviteeName: string,
  inviteUrl: string,
  companyName: string,
  inviterName?: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Mailer] RESEND_API_KEY non défini — email d\'invitation non envoyé');
    return;
  }
  await getResend().emails.send({
    from: FROM_DEFAULT,
    to,
    subject: 'Invitation à rejoindre SunanddriveOS',
    html: invitationEmailHtml(inviterName ?? companyName, companyName, inviteUrl),
  });
  void inviteeName;
}

export async function sendDeactivationEmail(
  to: string,
  userName: string,
  companyName: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Mailer] RESEND_API_KEY non défini — email de désactivation non envoyé');
    return;
  }
  await getResend().emails.send({
    from: FROM_DEFAULT,
    to,
    subject: 'Votre compte SunanddriveOS a été désactivé',
    html: deactivationEmailHtml(userName.split(' ')[0] ?? userName, companyName),
  });
}
