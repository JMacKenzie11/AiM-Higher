import "server-only";

import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { handoffPathFor } from "@/lib/aimee/handoff-path";
import type { VisibleCompany } from "./company";
import { AddRefused } from "./adds";

// WORK WITH AIMEE (0281). The assistant hands a short topic over and
// gets back a link; nothing else. The coaching happens in AiMS, under
// the person's own session, when they open the link: the agent is
// chosen then, from the list Aimee offers from (lib/aimee/handoff.ts).
//
// What is stored: the person and company (the database stamps who),
// the topic, and the SHA-256 of the link's random id. What the link
// carries: that id, never the topic. What comes back to the assistant:
// the link and one line to show. Never Aimee's replies, never a
// conversation.

export const HANDOFF_LINE = "This is something Aimee can help you work through in AiMS. Open it here:";

export async function workWithAimee(
  { db, company }: { db: SupabaseClient; userId: string; company: VisibleCompany },
  args: { topic: string }
) {
  const topic = args.topic.trim().replace(/\s+/g, " ");
  if (!topic) throw new AddRefused("Say in a line what the person wants help with.", "empty");
  if (topic.length > 500) throw new AddRefused("Keep the topic to a short summary, under 500 characters.", "too_long");
  const token = randomBytes(18).toString("base64url"); // 24 characters
  const { error } = await db.from("aimee_handoffs").insert({
    token_sha256: createHash("sha256").update(token, "utf8").digest("hex"),
    company_id: company.id,
    topic,
  });
  if (error) throw new AddRefused("AiMS couldn't make that link just now.", "handoff_failed");
  const link = `${await currentRequestOrigin()}${handoffPathFor(token)}`;
  return {
    company: company.name,
    link,
    message: `${HANDOFF_LINE} ${link}`,
    expires: "in 24 hours, and the link opens once, for this person only",
  };
}
