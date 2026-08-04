import type { Metadata } from "next";
import { demoUrl } from "../demo-url";
import { CoachPracticeMock } from "../mocks/CoachPracticeMock";
import styles from "../marketing.module.css";

// /coaches — the audience-specific companion to the owner-led
// landing page. Same route group, same design system, statically
// rendered. Nav swaps to a "For owners" link back to / (handled
// inside MarketingHeader via usePathname).

export const metadata: Metadata = {
  title:
    "AiMS Higher™ for coaches · Run your whole practice from one system",
  description:
    "AiMS Higher™ was built inside a working coaching practice. Every client's plan, rhythm, and follow-through in one place, with an always-available coach carrying the methodology between your sessions.",
};

export default function CoachesPage() {
  return (
    <>
      {/* --- Hero --- */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>FOR COACHES AND ADVISORS</p>
            <h1 className={styles.heroHeadline}>
              Your methodology, working between your sessions.
            </h1>
            <span className={styles.heroRule} aria-hidden="true" />
            <p className={styles.heroSupport}>
              AiMS Higher&trade; was built inside a working coaching practice
              to run real client engagements. The rhythm you use with your
              own clients is the rhythm we ship.
            </p>
            <div className={styles.heroCtas}>
              <a href={demoUrl()} className={styles.primaryCta}>
                Talk to us about becoming an AiMS Guide
              </a>
            </div>
          </div>

          <div className={styles.heroCard}>
            <CoachPracticeMock />
          </div>
        </div>
      </section>

      {/* --- The problem with great sessions --- */}
      <section className={styles.features}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>
            The problem with great sessions
          </h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <p className={styles.investmentIntro}>
            You run a strong session. The team leaves aligned. Then three
            weeks pass, the habits drift, and the next session starts with
            rebuilding what the last one built. The knowledge you bring
            visits the business. It doesn&rsquo;t live there. AiMS
            Higher&trade; keeps your work alive between visits: every
            client&rsquo;s plan, rhythm, and follow-through in one place,
            and Aimee, an always-available coach trained on the AiMS
            approach, carrying the methodology into the weeks you&rsquo;re
            not in the room.
          </p>
        </div>
      </section>

      {/* --- What an AiMS Guide gets --- */}
      <section className={styles.platformAtGlance}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>What an AiMS Guide gets</h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <div className={styles.problemGrid}>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                Run every client from one login
              </h3>
              <p className={styles.problemCardBody}>
                Switch scope between clients without leaving the app. Their
                dashboards, their plans, their people. One session on your
                laptop covers a whole book of business.
              </p>
            </div>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                Meeting analysis after every leadership call
              </h3>
              <p className={styles.problemCardBody}>
                Drop the transcript in the shared folder. The platform
                writes the summary, extracts the commitments, and files
                them for the client automatically.
              </p>
            </div>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                An always-available coach trained on the AiMS Approach to
                unlocking capacity
              </h3>
              <p className={styles.problemCardBody}>
                Aimee carries the methodology into the weeks you&rsquo;re
                not in the room, grounded in the client&rsquo;s real
                execution data. The work keeps going between visits.
              </p>
            </div>
            <div className={styles.problemCard}>
              <h3 className={styles.problemCardTitle}>
                A training library your clients can learn from
              </h3>
              <p className={styles.problemCardBody}>
                A shared library of lessons and video trainings your
                clients can watch on their own time. Aimee can recommend
                the right training when the moment fits.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- How it works --- */}
      <section className={styles.howItWorks}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionHeadline}>Getting started</h2>
          <span className={styles.sectionRule} aria-hidden="true" />
          <ol className={styles.howGrid}>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>1</span>
              <h3 className={styles.howCardTitle}>Talk with us</h3>
              <p className={styles.howCardBody}>
                A conversation about your practice and how AiMS Higher fits
                the way you already work with clients.
              </p>
            </li>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>2</span>
              <h3 className={styles.howCardTitle}>Bring your first client</h3>
              <p className={styles.howCardBody}>
                Your engagement runs on the platform from the first working
                session. Their plan, their rhythm, their people, all in one
                place.
              </p>
            </li>
            <li className={styles.howCard}>
              <span className={styles.howStepNumber}>3</span>
              <h3 className={styles.howCardTitle}>Scale your practice</h3>
              <p className={styles.howCardBody}>
                Every client in one system, your methodology reinforced
                daily.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* --- Closing CTA --- */}
      <section className={styles.closingCta}>
        <div className={styles.closingCtaInner}>
          <h2 className={styles.closingCtaHeadline}>
            Coach more clients, better, without cloning yourself.
          </h2>
          <div>
            <a href={demoUrl()} className={styles.primaryCta}>
              Talk to us about becoming an AiMS Guide
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
