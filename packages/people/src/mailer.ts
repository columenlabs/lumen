/**
 * The mailer is the app's: any function that sends one email and says whether it went. The
 * people routes only build the invite email and hand it over, so an app plugs in whatever it
 * sends with (an email API, an SMTP relay, a queue). With no mailer, every invite gives a link
 * to send by hand.
 */
import type { MailOutcome } from '@columenlabs/lumen-ui-types/people';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type Mailer = (message: MailMessage) => Promise<MailOutcome>;

export interface InviteMail {
  to: string;
  /** The app's name, as the person knows it. */
  appName: string;
  /** Who invited them (a name or an email). */
  inviter: string;
  /** The single-use link. */
  url: string;
  /** What they get, in words: `Notes (View), Billing (Admin)`. */
  access: string[];
  expiresAt: number | null;
  /** The inviter's own line. */
  note?: string;
}

/** Builds the invite email; an app passes its own to change the words or the look. */
export type InviteTemplate = (i: InviteMail) => Pick<MailMessage, 'subject' | 'html' | 'text'>;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export const inviteTemplate: InviteTemplate = (i) => {
  const access = i.access.length ? `You get ${i.access.join(', ')}.` : '';
  const until = i.expiresAt ? `The link works until ${day(i.expiresAt)}.` : '';
  const text = [
    `${i.inviter} invited you to ${i.appName}.`,
    access,
    i.note ? `"${i.note}"` : '',
    `Accept: ${i.url}`,
    `${until} Sign in with ${i.to}. Not expecting this? Ignore it.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1c1917;max-width:520px;margin:0 auto;padding:24px">
<p><strong>${esc(i.inviter)}</strong> invited you to ${esc(i.appName)}.</p>${access ? `\n<p>${esc(access)}</p>` : ''}${i.note ? `\n<p style="border-left:3px solid #d6d3d1;padding-left:12px;color:#57534e">${esc(i.note)}</p>` : ''}
<p style="margin:24px 0"><a href="${esc(i.url)}" style="background:#1c1917;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Accept invite</a></p>
<p style="color:#78716c;font-size:13px">${esc(until)} Sign in with ${esc(i.to)}. Not expecting this? Ignore it.</p>
</body></html>`;
  return { subject: `${i.inviter} invited you to ${i.appName}`, html, text };
};
