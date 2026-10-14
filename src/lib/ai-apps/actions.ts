"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { currentHelpViewer, helpFeaturesFor, loadHelpForRoute } from "@/lib/help/loader";
import { splitAiAppsGuide, type AiAppsGuide } from "./guide";

// The drawer's content, for the signed-in person: docs/help/ai-apps.md
// through the help loader, so the same role, feature and instance
// rules apply as everywhere help is read. Nothing in the browser
// decides what it gets.
export async function aiAppsGuideAction(): Promise<AiAppsGuide> {
  const session = await requireProfile();
  const viewer = await currentHelpViewer();
  const features = helpFeaturesFor(session.profile.role, viewer);
  if (!features.has("outside_assistants") && !features.has("ai_apps_off")) return { state: "closed" };
  const doc = await loadHelpForRoute("/ai-apps", session.profile.role, viewer);
  if (!doc) return { state: "closed" };
  const { intro, off, apps } = splitAiAppsGuide(doc.markdown);
  if (features.has("ai_apps_off")) return { state: "off", intro, off: off ?? "" };
  return apps.length > 0 ? { state: "on", intro, apps } : { state: "closed" };
}
