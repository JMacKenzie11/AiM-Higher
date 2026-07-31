import "server-only";

import { Resend } from "resend";
import { APP_URL } from "@/lib/supabase/env";

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

function from(): string {
  return process.env.EMAIL_FROM ?? "AiMS <noreply@aimshigher.com>";
}

export type CommitmentEmailInput = {
  meetingTitle: string;
  recipients: string[];
  commitmentsByOwner: Array<{
    ownerName: string; // "Unassigned" for null owners
    isUnassigned: boolean;
    items: Array<{ description: string; dueDate: string }>;
  }>;
};

export async function sendCommitmentEmail(
  input: CommitmentEmailInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = client();
  if (!c) {
    console.warn(
      "sendCommitmentEmail skipped — RESEND_API_KEY is not set."
    );
    return { ok: false, message: "Resend not configured." };
  }
  if (input.recipients.length === 0) {
    return { ok: false, message: "No recipients." };
  }

  try {
    const html = renderCommitmentHtml(input);
    const subject = `Commitments from ${input.meetingTitle}`;
    const result = await c.emails.send({
      from: from(),
      to: input.recipients,
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
    console.error("sendCommitmentEmail threw", err);
    return { ok: false, message };
  }
}

// ============================================================
// HTML template — branded simply: navy heading, sand background,
// logo mark only (no photos), sensible dark/light neutrality.
// ============================================================
function renderCommitmentHtml(input: CommitmentEmailInput): string {
  const openUrl = `${APP_URL()}/commitments`;

  const ownerBlocks = input.commitmentsByOwner
    .map((group) => {
      const items = group.items
        .map(
          (i) =>
            `<li style="margin: 4px 0; line-height: 1.5;">${escape(i.description)} <span style="color:#647388; font-size: 13px;">· ${escape(i.dueDate)}</span></li>`
        )
        .join("");
      const nameStyle = group.isUnassigned
        ? "color: #647388; font-style: italic;"
        : "color: #142647;";
      return `
        <div style="margin-top: 20px;">
          <div style="${nameStyle} font-weight: 700; font-size: 15px; margin-bottom: 6px;">${escape(group.ownerName)}</div>
          <ul style="margin: 0; padding-left: 20px; color: #1d2b4a;">${items}</ul>
        </div>
      `;
    })
    .join("");

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
                <h1 style="margin: 0; font-size: 22px; line-height: 1.25; color: #142647;">Commitments from ${escape(input.meetingTitle)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 32px 4px; color: #465470; font-size: 14px; line-height: 1.5;">
                Here are the commitments captured from your meeting. Open Commitments to work them.
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 12px;">
                ${ownerBlocks}
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px 28px;">
                <a href="${openUrl}" style="display:inline-block; background:#0057ff; color:#ffffff; text-decoration:none; padding: 10px 20px; border-radius: 999px; font-weight: 600; font-size: 14px;">Open Commitments</a>
              </td>
            </tr>
          </table>
          <div style="color:#8892a6; font-size: 12px; margin-top: 16px;">You're receiving this because you're on this company's roster in AiMSHigher.</div>
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
