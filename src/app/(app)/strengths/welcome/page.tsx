import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import StartAssessmentButton from "./StartAssessmentButton";

export default async function WelcomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, role, company_id")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/sign-in");

  const { data: existing } = await supabase
    .from("strengths_assessments")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.status === "completed") redirect("/strengths/results");
  if (existing?.status === "in_progress") redirect("/strengths/assessment");

  return (
    <>

      <main className="container">
        <div className="hero-band">
          <div className="stack-5" style={{ maxWidth: 600 }}>
            <div className="subhead">The AiMS Strengths Assessment</div>
            <h1 className="chartreuse-underline">
              Welcome, {profile.first_name}.
            </h1>
            <p>
              This is about discovering where your strengths and energy already
              are. It isn't a grading exercise, and there aren't any wrong
              answers.
            </p>
            <p>
              You'll rate a set of statements, then choose between a few
              paired options, then answer a couple of questions in your own
              words. Some things you'll agree with strongly, others you won't.
              Both tell us something useful about how your energy is
              configured.
            </p>
            <p>
              A low score isn't a weakness. It's a signal about where your
              energy is better spent elsewhere. The whole picture is what
              matters, not any single answer.
            </p>
            <p className="muted">Give yourself about ten to twelve minutes.</p>
            <StartAssessmentButton
              userId={user.id}
              companyId={profile.company_id}
            />
          </div>
        </div>
      </main>
    </>
  );
}
