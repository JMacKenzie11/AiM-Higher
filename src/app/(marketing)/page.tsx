import Link from "next/link";
import { Faq } from "./Faq";
import { demoUrl } from "./demo-url";
import { HeroDashboardMock } from "./mocks/HeroDashboardMock";
import { CommitmentsListMock } from "./mocks/CommitmentsListMock";
import { TranscriptFlowMock } from "./mocks/TranscriptFlowMock";
import { CoachExchangeMock } from "./mocks/CoachExchangeMock";
import { CascadeMock } from "./mocks/CascadeMock";
import styles from "./marketing.module.css";

// Public landing page. Rendered statically; middleware bounces
// authenticated visitors to /dashboard so this page only serves
// anons. No client JS on this file. See marketing.module.css for
// every visual — no hardcoded hex, all tokens.

export default function LandingPage() {
  return (
    <>
      {/* --- Hero --- */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>
              THE OPERATING SYSTEM FOR THE AiMS METHOD
            </p>
            <h1 className={styles.heroHeadline}>
              Leadership Simplified.
              <br />
              Results Amplified.
            </h1>
            <span className={styles.heroRule} aria-hidden="true" />
            <p className={styles.heroSubhead}>
              Your strategy, your meetings, and your follow-through.
              In one place.
            </p>
            <p className={styles.heroSupport}>
              AiMS Higher&trade; turns your strategic plan into weekly
              commitments, tracks whether they actually happen, and puts
              always-available coaches into every leader&rsquo;s rhythm to
              unlock the capacity already inside your team.
            </p>
            <div className={styles.heroCtas}>
              <a href={demoUrl()} className={styles.primaryCta}>
                Book a demo
              </a>
              <Link href="/sign-in" className={styles.heroSignIn}>
                Sign in
              </Link>
            </div>
          </div>

          <div className={styles.heroCard}>
            <HeroDashboardMock />
          </div>
        </div>
      </section>

      {/* --- The problem --- */}
      <section className={styles.problem}>
        <div className={styles.sectionInner}>
          <h2 className={styles.problemHeadline}>
            Most plans don&rsquo;t fail. They fade.
          </h2>
          <span className={styles.problemRule} aria-hidden="true" />
          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                The plan lives in a slide deck
              </h3>
              <p className={styles.problemCardBody}>
                Strategy gets built in an offsite and never touches Monday
                morning. By the time the team is heads-down on the week, the
                plan is a PDF nobody opens.
              </p>
            </div>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                Commitments evaporate
              </h3>
              <p className={styles.problemCardBody}>
                People agree to things in meetings, nobody writes them down the
                same way, and by next week the agreement is a memory. There is
                no shared source of truth.
              </p>
            </div>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                You can&rsquo;t see follow-through
              </h3>
              <p className={styles.problemCardBody}>
                You know who feels busy, but not who actually does what they
                said they would. The signal you need to lead is the one you
                can&rsquo;t see.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- Feature spotlights --- */}
      <section className={styles.features}>
        <div className={styles.sectionInner}>
          <FeatureRow
            eyebrow="WEEKLY RHYTHM"
            title="Commitments with a follow-through rate."
            body={
              <>
                <p>
                  One master list, every agreement tracked. Kept and missed
                  with reasons in people&rsquo;s own words.
                </p>
                <p>
                  A follow-through rate that makes accountability visible
                  without shame. You see the pattern before the pattern becomes
                  the story.
                </p>
              </>
            }
            visual={<CommitmentsListMock />}
            reverse={false}
          />

          <FeatureRow
            eyebrow="MEETING INTELLIGENCE"
            title="Your meetings fill in the system by themselves."
            body={
              <>
                <p>
                  Drop a transcript in a folder. The platform analyzes the
                  meeting, drafts the summary, and adds the commitments people
                  made, automatically.
                </p>
                <p>
                  The team gets emailed the list before lunch. Nothing else on
                  the calendar changes.
                </p>
              </>
            }
            visual={<TranscriptFlowMock />}
            reverse
          />

          <FeatureRow
            eyebrow="INTERACTIVE COACHING"
            title="Coaches trained on the AiMS approach. Ready when your leaders are."
            body={
              <>
                <p>
                  Aimee is an interactive, always-available coach trained on
                  the tools AiMS advisors use to unlock capacity in leaders,
                  teams, and businesses. Grounded in your team&rsquo;s real
                  execution data: their commitments, follow-through, and
                  reasons. Not generic advice.
                </p>
                <p>
                  Every conversation is private to the person who starts it.
                  Managers can keep their own private notes about the people
                  they coach; nobody else sees them.
                </p>
              </>
            }
            visual={<CoachExchangeMock />}
            reverse={false}
          />

          <FeatureRow
            eyebrow="ONE-PAGE PLAN"
            title="From purpose to this week&rsquo;s work, connected."
            body={
              <>
                <p>
                  Purpose, vision, focus areas, annual goals, quarterly
                  priorities, weekly commitments. Each level hangs from the one
                  above.
                </p>
                <p>
                  Progress rolls up so the dashboard tells the truth about how
                  the plan is actually moving.
                </p>
              </>
            }
            visual={<CascadeMock />}
            reverse
          />
        </div>
      </section>

      {/* --- Platform at a glance --- */}
      <section id="platform" className={styles.platformAtGlance}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>
            Everything the AiMS method needs. Nothing it doesn&rsquo;t.
          </h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <div className={styles.pillarGrid}>
            <div className={styles.pillarCol}>
              <p className={styles.pillarEyebrow}>PEOPLE</p>
              <ul className={styles.pillarList}>
                <li>Functional chart with outcomes and success measures</li>
                <li>Coaching threads private to their author</li>
                <li>Follow-through visible by person</li>
              </ul>
            </div>
            <div className={styles.pillarCol}>
              <p className={styles.pillarEyebrow}>RHYTHMS</p>
              <ul className={styles.pillarList}>
                <li>Weekly commitments with kept, missed, and reasons</li>
                <li>Meeting analysis and facilitation review</li>
                <li>Quarterly planning cycles</li>
              </ul>
            </div>
            <div className={styles.pillarCol}>
              <p className={styles.pillarEyebrow}>DATA</p>
              <ul className={styles.pillarList}>
                <li>Success measures with weekly tracking</li>
                <li>Dashboard with a weekly coaching brief</li>
                <li>Strategic progress roll-up</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --- For coaches --- */}
      <section id="for-coaches" className={styles.forCoaches}>
        <div className={styles.forCoachesInner}>
          <div className={styles.forCoachesCopy}>
            <h2 className={styles.forCoachesHeadline}>
              Built by coaches. Built for coaches.
            </h2>
            <p className={styles.forCoachesBody}>
              This platform was built inside a working coaching practice to run
              real client engagements. The rhythm you use on your own team is
              the rhythm we ship.
            </p>
            <p className={styles.forCoachesBody}>
              It gives an AiMS Guide every client&rsquo;s plan, rhythm, and
              follow-through in one place. Aimee, an always-available coach
              trained on the AiMS approach, carries the methodology between
              sessions so the work of unlocking capacity keeps going when the
              guide isn&rsquo;t in the room.
            </p>
            <div className={styles.forCoachesCtaRow}>
              <a href={demoUrl()} className={styles.primaryCta}>
                Talk to us about becoming an AiMS Guide
              </a>
            </div>
          </div>

          <div className={styles.forCoachesCard}>
            <ul className={styles.forCoachesList}>
              <li>Run every client from one login</li>
              <li>Meeting analysis after every leadership call</li>
              <li>
                An always-available coach trained on the AiMS approach to
                unlocking capacity
              </li>
              <li>A training library your clients can learn from</li>
            </ul>
          </div>
        </div>
      </section>

      {/* --- How it works --- */}
      <section id="how-it-works" className={styles.howItWorks}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>Getting started</h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <ol className={styles.howGrid}>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>1</span>
              <h3 className={styles.howCardTitle}>Talk with us</h3>
              <p className={styles.howCardBody}>
                A conversation about your business and whether the AiMS method
                fits. Thirty minutes; no obligation.
              </p>
            </li>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>2</span>
              <h3 className={styles.howCardTitle}>
                Set up your operating system
              </h3>
              <p className={styles.howCardBody}>
                Your guide helps load your plan, people, and rhythm, usually
                inside your first working session.
              </p>
            </li>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>3</span>
              <h3 className={styles.howCardTitle}>Run your first week</h3>
              <p className={styles.howCardBody}>
                One leadership meeting in, your commitments are tracked and
                your dashboard is live.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* --- FAQ --- */}
      <section id="faq" className={styles.faqSection}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>Common questions</h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <Faq
            items={[
              {
                question: "Is this EOS software?",
                answer: (
                  <p>
                    No. AiMS Higher&trade; runs the AiMS method, an always-on operating
                    system built around appreciative inquiry, weekly
                    follow-through, and embedded coaching. If you have run EOS
                    or Scaling Up, the concepts will feel familiar and the
                    difference shows up in what happens between meetings.
                  </p>
                ),
              },
              {
                question: "Who sees my data?",
                answer: (
                  <p>
                    Your company&rsquo;s data is isolated to your company.
                    Coaching conversations are private to the person who starts
                    them. We state who can see what directly in the product,
                    on every screen where it matters.
                  </p>
                ),
              },
              {
                question: "Do we need a coach to use it?",
                answer: (
                  <p>
                    It is delivered through AiMS Guides today. Talk to us about
                    what fits your team.
                  </p>
                ),
              },
              {
                question: "How does the coaching work?",
                answer: (
                  <p>
                    Aimee is an interactive, always-available coach trained
                    on the AiMS approach to unlocking capacity. She uses the
                    same tools our advisors use in the room, grounded in
                    your company&rsquo;s real data (plan, commitments,
                    follow-through, meeting outcomes) through a set of
                    server-side tools. Your data is never used to train her.
                    Every conversation surface tells you what she read to
                    answer.
                  </p>
                ),
              },
            ]}
          />
        </div>
      </section>

      {/* --- Closing CTA --- */}
      <section className={styles.closingCta}>
        <div className={styles.closingCtaInner}>
          <h2 className={styles.closingCtaHeadline}>
            See it on your own numbers.
          </h2>
          <p className={styles.closingCtaBody}>
            A demo takes thirty minutes and we run it on scenarios from your
            world, not ours.
          </p>
          <div>
            <a href={demoUrl()} className={styles.primaryCta}>
              Book a demo
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function FeatureRow({
  eyebrow,
  title,
  body,
  visual,
  reverse,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  visual: React.ReactNode;
  reverse: boolean;
}) {
  return (
    <div
      className={styles.featureRow}
      data-reverse={reverse ? "true" : undefined}
    >
      <div className={styles.featureCopy}>
        <p className={styles.featureEyebrow}>{eyebrow}</p>
        <h3 className={styles.featureHeadline}>{title}</h3>
        <div className={styles.featureBody}>{body}</div>
      </div>
      <div className={styles.featureVisual}>{visual}</div>
    </div>
  );
}
