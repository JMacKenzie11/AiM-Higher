import "server-only";

import type { CoachTool } from "@/lib/coach/tools";
import type { PracticeToolName } from "@/lib/practices/registry";
import { buildRoleDescriptionTools } from "@/lib/role-descriptions/agent-tools";
import { buildGuideTools } from "@/lib/guide/agent-tools";

// Practice tool tags to the tools themselves.
//
// The registry holds string tags rather than builders, so it stays
// serializable to the client components that render the agent
// picker. This is where they become tools, and it is the one place
// a new practice tool set has to be added.
//
// An unknown tag is DROPPED, not thrown. A typo in the registry
// should cost the agent a tool it can notice missing, not the whole
// conversation with a 500.
export function resolvePracticeTools(
  names: readonly PracticeToolName[] | undefined,
  companyId: string,
  revisingRoleId: string | null,
  debriefingMeetingId: string | null
): CoachTool[] {
  if (!names || names.length === 0) return [];
  const wanted = new Set<string>(names);
  const available = [
    ...(wanted.has("get_foundation") ||
    wanted.has("list_functions") ||
    wanted.has("get_role_description")
      ? buildRoleDescriptionTools({ companyId, revisingRoleId })
      : []),
    ...(wanted.has("get_meeting_debrief")
      ? buildGuideTools({ debriefingMeetingId })
      : []),
  ];
  return available.filter((t) => wanted.has(t.definition.name));
}
