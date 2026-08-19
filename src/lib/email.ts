import "server-only";

import { Resend } from "resend";

// One entry point per email kind. Failures are logged and returned,
// never thrown — the transcript pipeline treats email as best-effort
// and continues on failure.

let cached: Resend | null = null;

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (cached) return cached;
  cached = new Resend(key);
  return cached;
}

// Sender is the EMAIL_FROM env var; fallback matches the current
// production domain so dev / test / first-boot has a sensible default.
// A domain migration is a Vercel env var change, not a code push.
function from(): string {
  return process.env.EMAIL_FROM ?? "AiMS <noreply@aims-hq.com>";
}

export type InviteEmailInput = {
  to: string;
  firstName?: string | null;
  actionLink: string;
};

// Invite email for the "resend to an existing pending user" path.
// Supabase's admin.generateLink() only returns the link — it does
// not send email — so we deliver it ourselves via Resend to match
// what inviteUserByEmail() does for brand-new invitees.
export async function sendInviteEmail(
  input: InviteEmailInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = client();
  if (!c) {
    console.warn(
      "sendInviteEmail skipped — RESEND_API_KEY is not set."
    );
    return { ok: false, message: "Resend not configured." };
  }

  try {
    const html = renderInviteHtml(input);
    const subject = "You're invited to AiMSHigher";
    const result = await c.emails.send({
      from: from(),
      to: [input.to],
      subject,
      html,
    });
    if (result.error) {
      console.error("Resend send error", result.error);
      return { ok: false, message: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sendInviteEmail threw", err);
    return { ok: false, message };
  }
}

export type ResetEmailInput = {
  to: string;
  firstName?: string | null;
  actionLink: string;
};

// Password-reset email. Mirrors sendInviteEmail — Supabase's
// admin.generateLink({ type: "recovery" }) only returns the hashed
// token; we deliver the "reset your password" link ourselves via
// Resend and let /auth/callback verify the token server-side. Same
// pattern as invites so the whole auth-link surface is uniform and
// every send shows up in the Resend dashboard.
export async function sendResetEmail(
  input: ResetEmailInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = client();
  if (!c) {
    console.warn("sendResetEmail skipped — RESEND_API_KEY is not set.");
    return { ok: false, message: "Resend not configured." };
  }

  try {
    const html = renderResetHtml(input);
    const subject = "Reset your AiMSHigher password";
    const result = await c.emails.send({
      from: from(),
      to: [input.to],
      subject,
      html,
    });
    if (result.error) {
      console.error("Resend send error", result.error);
      return { ok: false, message: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sendResetEmail threw", err);
    return { ok: false, message };
  }
}

function renderInviteHtml(input: InviteEmailInput): string {
  const greeting = input.firstName
    ? `Hi ${escape(input.firstName)},`
    : "Hi,";

  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background: #f5f2e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f2e8; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius: 12px; overflow:hidden; max-width: 560px; width: 100%;">
            <tr>
              <td style="padding: 28px 32px 8px;">
                <div style="font-weight: 800; font-size: 20px; letter-spacing: -0.01em; color: #142647;">AiMS<span style="color:#0057ff;">Higher</span></div>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 4px;">
                <h1 style="margin: 0; font-size: 22px; line-height: 1.25; color: #142647;">You&rsquo;re invited to AiMSHigher</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 32px 4px; color: #465470; font-size: 14px; line-height: 1.55;">
                ${greeting} your account is ready. Set a password to finish signing up and jump in.
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px 8px;">
                <a href="${escape(input.actionLink)}" style="display:inline-block; background:#0057ff; color:#ffffff; text-decoration:none; padding: 10px 20px; border-radius: 999px; font-weight: 600; font-size: 14px;">Set up your account</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 28px; color: #8892a6; font-size: 12px; line-height: 1.5;">
                If the button doesn&rsquo;t work, paste this link into your browser:<br />
                <span style="color:#465470; word-break: break-all;">${escape(input.actionLink)}</span>
              </td>
            </tr>
          </table>
          <div style="color:#8892a6; font-size: 12px; margin-top: 16px;">You&rsquo;re receiving this because someone added you to a company on AiMSHigher.</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderResetHtml(input: ResetEmailInput): string {
  const greeting = input.firstName
    ? `Hi ${escape(input.firstName)},`
    : "Hi,";

  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background: #f5f2e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f5f2e8; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius: 12px; overflow:hidden; max-width: 560px; width: 100%;">
            <tr>
              <td style="padding: 28px 32px 8px;">
                <div style="font-weight: 800; font-size: 20px; letter-spacing: -0.01em; color: #142647;">AiMS<span style="color:#0057ff;">Higher</span></div>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 4px;">
                <h1 style="margin: 0; font-size: 22px; line-height: 1.25; color: #142647;">Reset your password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 32px 4px; color: #465470; font-size: 14px; line-height: 1.55;">
                ${greeting} click the button below to set a new password. If you didn&rsquo;t ask for this, you can safely ignore the email.
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px 8px;">
                <a href="${escape(input.actionLink)}" style="display:inline-block; background:#0057ff; color:#ffffff; text-decoration:none; padding: 10px 20px; border-radius: 999px; font-weight: 600; font-size: 14px;">Set a new password</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 28px; color: #8892a6; font-size: 12px; line-height: 1.5;">
                If the button doesn&rsquo;t work, paste this link into your browser:<br />
                <span style="color:#465470; word-break: break-all;">${escape(input.actionLink)}</span>
              </td>
            </tr>
          </table>
          <div style="color:#8892a6; font-size: 12px; margin-top: 16px;">You&rsquo;re receiving this because a password reset was requested for your AiMSHigher account.</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
