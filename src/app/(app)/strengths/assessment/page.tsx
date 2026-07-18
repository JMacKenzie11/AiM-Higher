import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AssessmentFlow from "./AssessmentFlow";
import type { Item } from "@/lib/strengths/types";

export default async function AssessmentPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, position, company_id")
    .eq("id", user.id)
    .single();
  if (!profile?.company_id) redirect("/strengths/welcome");

  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!assessment) redirect("/strengths/welcome");
  if (assessment.status === "completed") redirect("/strengths/results");

  const { data: items } = await supabase
    .from("strengths_items")
    .select("*")
    .order("sort_order", { ascending: true });

  const { data: responses } = await supabase
    .from("strengths_responses")
    .select("item_id, value")
    .eq("assessment_id", assessment.id);

  const { data: narrative } = await supabase
    .from("strengths_narrative_messages")
    .select("role, content, created_at")
    .eq("assessment_id", assessment.id)
    .order("created_at", { ascending: true });

  return (
    <AssessmentFlow
      assessmentId={assessment.id}
      items={(items ?? []) as Item[]}
      existingResponses={responses ?? []}
      existingNarrative={narrative ?? []}
      firstName={profile.first_name}
    />
  );
}
