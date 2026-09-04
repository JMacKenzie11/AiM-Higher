import Link from "next/link";
import { Faq } from "./Faq";
import { RevealOnScroll } from "./RevealOnScroll";
import { demoUrl } from "./demo-url";
import { HeroDashboardMock } from "./mocks/HeroDashboardMock";
import { CommitmentsListMock } from "./mocks/CommitmentsListMock";
import { TranscriptFlowMock } from "./mocks/TranscriptFlowMock";
import { CoachExchangeMock } from "./mocks/CoachExchangeMock";
import { CascadeMock } from "./mocks/CascadeMock";
import styles from "./marketing.module.css";

// Public landing page. Sold to owner-led companies; the coach
// audience lives on /coaches. Rendered statically; middleware
// bounces authenticated visitors to /dashboard so this page only
// serves anons. See marketing.module.css for every visual: no
// hardcoded hex, all tokens.

export default function LandingPage() {
  return (
    <>
      {/* --- Hero --- */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>
              FOR OWNER-LED COMPANIES, $2M TO $50M
            </p>
            <h1 className={styles.heroHeadline}>
              Stop being the bottleneck. Start being the CEO.
            </h1>
            <span className={styles.heroRule} aria-hidden="true" />
            <p className={styles.heroSubhead}>
              A team that executes without you in every room. A management
              system that doesn&rsquo;t leave when the consultant does.
            </p>
            <p className={styles.heroSupport}>
              AiMS HQ&trade; turns your strategic plan into weekly
              commitments, tracks whether they actually happen, and puts an
              always-available coach into every leader&rsquo;s rhythm. The
              capacity is already inside your team. This is the system that
              unlocks it.
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

      {/* --- The enemy --- */}
      <section className={styles.problem}>
        <div className={styles.sectionInner}>
          <h2 className={styles.problemHeadline}>
            You&rsquo;re still the answer to every question.
          </h2>
          <span className={styles.problemRule} aria-hidden="true" />
          <p className={styles.problemIntro}>
            You&rsquo;ve done the planning. You&rsquo;ve hired good people.
            And you&rsquo;re still in every follow-up, every decision, every
            reason the week actually happens. That&rsquo;s not a leadership
            problem. It&rsquo;s a system problem. And most management
            systems were built for episodes, not for the days in between.
            Quarterly sessions. Weekly meetings. A binder. A facilitator.
            They live when someone drives them and fade when that person
            steps back. Consultants visit. This stays.
          </p>
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
                People agree to things in meetings, nobody writes them down
                the same way, and by next week the agreement is a memory.
                There is no shared source of truth.
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
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                The system leaves with the driver
              </h3>
              <p className={styles.problemCardBody}>
                When the facilitator, the implementer, or the founder steps
                back, the structure goes with them. And you&rsquo;re back to
                holding the whole thing in your own head.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- Investment replacement argument --- */}
      <section className={styles.investment}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>
            You&rsquo;re already paying for a management system. In pieces.
          </h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <p className={styles.investmentIntro}>
            Growing companies spend $63K to $228K a year on fragments that
            each solve one piece and leave you holding it together.
          </p>
          <div className={styles.investmentGrid}>
            <div className={styles.investmentCard}>
              <h3 className={styles.investmentCardTitle}>
                AI subscriptions and tools, $12K to $60K a year
              </h3>
              <p className={styles.investmentCardBody}>
                Individual productivity goes up. Insights live in personal
                chat threads. The organization stays exactly as dependent on
                you as before.
              </p>
            </div>
            <div className={styles.investmentCard}>
              <h3 className={styles.investmentCardTitle}>
                The tech stack, $19K to $48K a year
              </h3>
              <p className={styles.investmentCardBody}>
                Project management, communications, documentation. You get
                task visibility, but you stay the escalation point, and the
                documentation decays the day someone stops maintaining it.
              </p>
            </div>
            <div className={styles.investmentCard}>
              <h3 className={styles.investmentCardTitle}>
                Implementers and coaches, $30K to $120K a year
              </h3>
              <p className={styles.investmentCardBody}>
                Strong sessions. Then the knowledge drives away with the
                implementer, and nothing reinforces the work between visits.
              </p>
            </div>
          </div>
          <p className={styles.investmentClose}>
            None of these hold it together. Every consultant goes home.
            Every AI subscription is one person&rsquo;s edge, not your
            company&rsquo;s system. AiMS HQ&trade; is the management
            system that doesn&rsquo;t leave. One always-on operating
            rhythm that replaces the pile for a fraction of what the
            fragments cost. Pricing is part of the first conversation.
          </p>
        </div>
      </section>

      {/* --- Proof and origin --- */}
      <section className={styles.origin}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>
            Built inside a real business, not a workshop.
          </h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <div className={styles.originGrid}>
            <div className={styles.originStory}>
              <p>
                Jeff Bouwman was running a $200M company with 600 people.
                Annual planning was in place, metrics were tracked, reviews
                happened, targets were set. And the targets were missed, year
                after year, while everything routed back to the founder.
              </p>
              <p>
                The unlock didn&rsquo;t come from a new framework. It came
                from a different question: not what do we need to do, but
                what do we already know that will work? He stopped solving
                alone and asked the room. The knowledge was already in the
                organization. It needed a system that could reach it. That
                became the AiMS Approach. Appreciative inquiry as the
                discipline, so every rhythm starts from what&rsquo;s already
                working, not from what&rsquo;s broken. $100M in new
                business, five warehouses eliminated, targets hit months
                early. AiMS HQ&trade; is that system, built into software.
              </p>
            </div>
            <aside className={styles.statBand}>
              <p className={styles.statBandLabel}>
                RESULTS FROM AiMS ENGAGEMENTS
              </p>
              <RevealOnScroll className={styles.statTileGrid}>
                <div className={styles.statTile}>
                  <span className={styles.statTileValue}>
                    $3M &rarr; $12M
                  </span>
                  <span className={styles.statTileCaption}>
                    Client revenue growth
                  </span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTileValue}>43% &rarr; 82%</span>
                  <span className={styles.statTileCaption}>
                    Employee engagement
                  </span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTileValue}>65 &rarr; 40 hrs</span>
                  <span className={styles.statTileCaption}>
                    Owner&rsquo;s work week, in 90 days, with Fridays back
                  </span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statTileValue}>150%</span>
                  <span className={styles.statTileCaption}>
                    Of the year-one growth target, secured in year one
                  </span>
                </div>
              </RevealOnScroll>
            </aside>
          </div>
        </div>
      </section>

      {/* --- Feature spotlights --- */}
      <section className={styles.features}>
        <div className={styles.sectionInner}>
          <FeatureRow
            eyebrow="WEEKLY RHYTHM"
            title="Stop being the follow-up department."
            body={
              <p>
                Every agreement your team makes lands in one list, tracked to
                done, with kept and missed and the reasons in people&rsquo;s
                own words. The follow-through rate makes accountability
                visible without shame, and you stop spending your week
                chasing what people already said they&rsquo;d do.
              </p>
            }
            visual={<CommitmentsListMock />}
            reverse={false}
          />

          <FeatureRow
            eyebrow="MEETING INTELLIGENCE"
            title="Your meetings do their own admin."
            body={
              <p>
                Drop a transcript in a folder. The platform analyzes the
                meeting, drafts the summary, and adds the commitments people
                made, automatically. The team gets the list by email before
                lunch, nothing falls through, and nobody had to be the
                person writing everything down. Nothing else on the calendar
                changes.
              </p>
            }
            visual={<TranscriptFlowMock />}
            reverse
          />

          <FeatureRow
            eyebrow="INTERACTIVE COACHING"
            title="Every leader gets a coach. Not just the ones who report to you."
            body={
              <p>
                Aimee is an always-available coach trained on the tools AiMS
                advisors use to unlock capacity, grounded in your team&rsquo;s
                real execution data: their commitments, their follow-through,
                their reasons. Your leaders get developed between your
                conversations, not only during them. Every conversation is
                private to the person who starts it.
              </p>
            }
            visual={<CoachExchangeMock />}
            reverse={false}
          />

          <FeatureRow
            eyebrow="ONE-PAGE PLAN"
            title="Know if the plan is moving without asking anyone."
            body={
              <p>
                Purpose, vision, focus areas, annual goals, quarterly
                actions, weekly commitments, each level hanging from the
                one above. Progress rolls up on its own, so the dashboard
                tells the truth about the quarter before the quarter is
                over.
              </p>
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
            Everything the AiMS Approach needs. Nothing it doesn&rsquo;t.
          </h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <div className={styles.pillarGrid}>
            <div className={styles.pillarCol}>
              <p className={styles.pillarEyebrow}>PEOPLE</p>
              <ul className={styles.pillarList}>
                <li>Functional chart with critical success factors and KPIs</li>
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
                <li>Key success measures with weekly tracking</li>
                <li>Dashboard with a weekly coaching brief</li>
                <li>Strategic progress roll-up</li>
              </ul>
            </div>
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
                A conversation about your business and whether the AiMS
                method fits. Thirty minutes, no obligation, and if it&rsquo;s
                not a fit, we&rsquo;ll tell you first.
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
                    No. AiMS HQ&trade; runs the AiMS Approach, an
                    always-on operating system built around appreciative
                    inquiry, weekly follow-through, and embedded coaching.
                    If you have run EOS or Scaling Up, the concepts will
                    feel familiar and the difference shows up in what
                    happens between meetings.
                  </p>
                ),
              },
              {
                question: "Who sees my data?",
                answer: (
                  <p>
                    Your company&rsquo;s data is isolated to your company.
                    Coaching conversations are private to the person who
                    starts them. We state who can see what directly in the
                    product, on every screen where it matters.
                  </p>
                ),
              },
              {
                question: "Do we need a coach to use it?",
                answer: (
                  <p>
                    It is delivered through AiMS Guides today. Talk to us
                    about what fits your team.
                  </p>
                ),
              },
              {
                question: "What does it cost?",
                answer: (
                  <p>
                    Pricing depends on how you&rsquo;re working with us and
                    it&rsquo;s part of the first conversation. What we can
                    tell you now: it replaces a stack that most growing
                    companies are already paying $63K to $228K a year for,
                    in pieces.
                  </p>
                ),
              },
              {
                question: "How does the coaching work?",
                answer: (
                  <p>
                    Aimee is an interactive, always-available coach trained
                    on the AiMS Approach to unlocking capacity. She uses
                    the same tools our advisors use in the room, grounded
                    in your company&rsquo;s real data (plan, commitments,
                    follow-through, meeting outcomes) through a set of
                    server-side tools. Your data is never used to train
                    her. Every conversation surface tells you what she read
                    to answer.
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
          <p className={styles.closingCtaEyebrow}>
            Simplified leadership. Amplified results.
          </p>
          <h2 className={styles.closingCtaHeadline}>
            See how it fits your business.
          </h2>
          <p className={styles.closingCtaBody}>
            Thirty minutes, run on scenarios from your world, not ours.
            You&rsquo;ll leave knowing whether it fits.
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
