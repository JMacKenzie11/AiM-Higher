import { requireRole } from "@/lib/auth/current-user";
import { listHubAgents, listHubCategories } from "@/lib/practices/hub-service";
import { isPrimaryInstance } from "@/lib/instances/primary";
import { AgentHubEditor } from "./AgentHubEditor";
import styles from "../companies/admin.module.css";

// The Agent Hub: name, describe, group, order and scope the Ask
// Aimee agents without a deploy.
//
// WHAT THIS PAGE DOES NOT DO, ON PURPOSE. It does not edit prompts,
// and it does not create agents. A prompt is the agent — nothing
// else decides whether it asks one question or eight — and editing
// one from a screen needs the immutable versioning that phase 2
// brings, so that a change cannot rewrite the prompt under a
// conversation already running on it. Until then the registry holds
// them, and this page holds everything around them.

export default async function AgentHubPage() {
  await requireRole(["system_admin"]);
  const [categories, agents, primary] = await Promise.all([
    listHubCategories(),
    listHubAgents(),
    // Agents are authored in one place (0231). Everywhere else this
    // page is a window: the same list, none of the controls. Asked
    // here rather than in the client half because the answer is a
    // database fact, and because the page should not render a
    // control and then take it away.
    isPrimaryInstance(),
  ]);

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Agent Hub">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={styles.h1}>Agent Hub</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {primary
              ? "Extend Ask Aimee by adding new agents."
              : "The agents available in Ask Aimee here. They are managed centrally, so this is a view rather than an editor."}
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <AgentHubEditor
          categories={categories}
          agents={agents}
          readOnly={!primary}
        />
      </div>
    </div>
  );
}
