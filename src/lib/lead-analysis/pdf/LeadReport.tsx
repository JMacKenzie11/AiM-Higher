import path from "node:path";
import {
  Defs,
  Document,
  Font,
  Image,
  LinearGradient,
  Page,
  Rect,
  Stop,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  computeOverall,
  SCORE_PART_DESCRIPTIONS,
  type OverallScore,
} from "@/lib/leadership/facilitation/score";
import type {
  FacilitationDimension,
  FacilitationMoment,
  FacilitationReview,
} from "@/lib/leadership/facilitation/types";
import { commitmentQuality } from "../context";
import { parseMarkdown, splitSections, type Block, type Inline } from "../markdown";
import type { LeadAnalysisRow } from "../types";

// THE FREE MEETING ANALYSIS, AS A PDF.
//
// AiMS Institute branding, from the brand handoff ("PDF reports"):
// a --grad-brand cover with the white logo and a chartreuse underline
// under the title; sand and white body pages on the same type scale,
// Inter for headings, labels and numbers, Figtree for reading text,
// nothing under 12px... except page furniture, which is 9pt. Colours
// are the brand tokens (brand/tokens.css), written out here because a
// PDF cannot read CSS custom properties.

const ASSETS = path.join(process.cwd(), "src", "lib", "lead-analysis", "pdf", "assets");

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Inter",
    fonts: [400, 600, 700, 800].map((w) => ({ src: path.join(ASSETS, `Inter-${w}.ttf`), fontWeight: w })),
  });
  Font.register({
    family: "Figtree",
    fonts: [400, 600, 700].map((w) => ({ src: path.join(ASSETS, `Figtree-${w}.ttf`), fontWeight: w })),
  });
  // Whole words only: a hyphenated name reads as a typo.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const C = {
  navy: "#1F3352",
  navyMid: "#2A4478",
  cobalt: "#3551A4",
  sky: "#8CC4DF",
  chartreuse: "#D6E264",
  midnight: "#11151A",
  sand: "#F7F7F2",
  white: "#FFFFFF",
  cobaltTint: "#EBEFF9",
  skyTint: "#E8F3F9",
  navyTint: "#E9ECF1",
  chartreuseTint: "#F5F8DC",
  success: "#3E7141",
  successTint: "#EAF2EA",
  warning: "#8D6222",
  warningTint: "#F7EFE0",
  muted: "#5B6472",
  faint: "#606A77",
  border: "#E2E4DE",
};

const s = StyleSheet.create({
  page: {
    backgroundColor: C.white,
    paddingTop: 72,
    paddingBottom: 64,
    paddingHorizontal: 54,
    fontFamily: "Figtree",
    fontSize: 10.5,
    color: C.midnight,
  },
  // The reading text's line spacing, 1.55 x 10.5, on the content and in
  // points. Not on the page: see the header's note.
  content: { lineHeight: "16.3pt" },
  // THE HEADER AND FOOTER ARE SEPARATE PINNED PIECES, each with a fixed
  // size, never a row of children inside one fixed View. That row form
  // broke on long reports: @react-pdf/renderer re-lays a fixed element
  // out on every page a section continues onto, and the footer row (with
  // its page-number line) grew about 64 times per page until pdfkit
  // refused the number ("unsupported number: -9.6e+21") and the PDF route
  // returned a blank page. First seen on a real 37-page report,
  // 2026-10-13; lead-report.test.tsx renders a long one to hold it.
  headerLogo: { position: "absolute", top: 20, left: 54, width: 30, height: 30 },
  headerText: {
    position: "absolute",
    top: 31,
    right: 54,
    width: 420,
    height: 10,
    textAlign: "right",
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.4,
    color: C.muted,
    textTransform: "uppercase",
  },
  headerRule: { position: "absolute", top: 56, left: 54, right: 54, height: 1, backgroundColor: C.border },
  footerText: {
    position: "absolute",
    bottom: 24,
    height: 10,
    fontFamily: "Inter",
    fontSize: 8,
    color: C.faint,
  },
  eyebrow: { fontFamily: "Inter", fontSize: 8.5, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: C.cobalt, marginBottom: 6 },
  h1: { fontFamily: "Inter", fontSize: 22, fontWeight: 700, color: C.navy, lineHeight: 1.25 },
  rule: { width: 56, height: 3, borderRadius: 2, backgroundColor: C.chartreuse, marginTop: 8, marginBottom: 18 },
  h2: { fontFamily: "Inter", fontSize: 14, fontWeight: 700, color: C.navy, marginTop: 18, marginBottom: 6 },
  h3: { fontFamily: "Inter", fontSize: 12, fontWeight: 700, color: C.navy, marginTop: 12, marginBottom: 4 },
  h4: { fontFamily: "Inter", fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, marginTop: 10, marginBottom: 3 },
  p: { marginBottom: 6 },
  bold: { fontWeight: 700 },
  italic: { color: C.muted },
  listRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 12, color: C.cobalt, fontFamily: "Inter", fontWeight: 700 },
  listText: { flex: 1 },
  card: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: C.white },
  cardSand: { borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: C.sand },
  cardTitle: { fontFamily: "Inter", fontSize: 10.5, fontWeight: 700, color: C.navy, marginBottom: 3 },
  muted: { color: C.muted },
  small: { fontSize: 9.5 },
  label: { fontFamily: "Inter", fontSize: 8, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted },
});

// ---------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------

function Spans({ inline }: { inline: Inline[] }) {
  return (
    <>
      {inline.map((x, i) => (
        <Text key={i} style={x.bold ? s.bold : x.italic ? s.italic : undefined}>
          {x.text}
        </Text>
      ))}
    </>
  );
}

function Markdown({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const style = b.level === 2 ? s.h2 : b.level === 3 ? s.h3 : s.h4;
          return (
            <Text key={i} style={style} minPresenceAhead={40}>
              {b.text}
            </Text>
          );
        }
        if (b.type === "paragraph") {
          return (
            <Text key={i} style={s.p}>
              <Spans inline={b.inline} />
            </Text>
          );
        }
        let n = 0;
        return (
          <View key={i} style={{ marginBottom: 6 }}>
            {b.items.map((item, j) => {
              if (item.depth === 0) n += 1;
              const marker = b.ordered && item.depth === 0 ? `${n}.` : item.depth === 0 ? "•" : "–";
              return (
                <View key={j} style={[s.listRow, { paddingLeft: item.depth * 14 }]} wrap={false}>
                  <Text style={s.bullet}>{marker}</Text>
                  <Text style={s.listText}>
                    <Spans inline={item.inline} />
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );
}

function PageFrame({
  row,
  section,
  children,
}: {
  row: LeadAnalysisRow;
  section: string;
  children: React.ReactNode;
}) {
  return (
    <Page size="LETTER" style={s.page}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
      <Image src={path.join(ASSETS, "logo-navy.png")} style={s.headerLogo} fixed />
      <Text style={s.headerText} fixed>
        {section} {"\u00b7"} {row.company_name}
      </Text>
      <View style={s.headerRule} fixed />
      <View style={s.content}>{children}</View>
      <Text style={[s.footerText, { left: 54, width: 330 }]} fixed>
        Prepared for {row.full_name}, {row.company_name}
      </Text>
      <Text
        style={[s.footerText, { right: 54, width: 170, height: undefined, textAlign: "right" }]}
        fixed
        render={({ pageNumber, totalPages }) => `The AiMS Institute \u00b7 ${pageNumber} of ${totalPages}`}
      />
    </Page>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View minPresenceAhead={80}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.h1}>{title}</Text>
      <View style={s.rule} />
    </View>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 9,
        height: 9,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: on ? C.success : C.warning,
        backgroundColor: on ? C.success : C.white,
      }}
    />
  );
}

function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 3,
        paddingHorizontal: 7,
        borderRadius: 9,
        backgroundColor: on ? C.successTint : C.warningTint,
        marginRight: 6,
      }}
    >
      <Dot on={on} />
      <Text style={{ fontFamily: "Inter", fontSize: 8, fontWeight: 600, lineHeight: 1, color: on ? C.success : C.warning }}>{label}</Text>
    </View>
  );
}

function ScoreBar({ label, raw, outOf, weight }: { label: string; raw: number; outOf: number; weight: number }) {
  const pct = Math.max(0, Math.min(1, raw / outOf));
  return (
    <View style={{ marginBottom: 9 }} wrap={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ fontFamily: "Inter", fontSize: 9.5, fontWeight: 600, color: C.navy }}>{label}</Text>
        <Text style={{ fontFamily: "Inter", fontSize: 9.5, fontWeight: 700, color: C.navy }}>
          {raw}/{outOf}
          <Text style={{ fontWeight: 400, color: C.faint }}>
            {"  "}weight {weight}%
          </Text>
        </Text>
      </View>
      <View style={{ height: 7, borderRadius: 4, backgroundColor: C.navyTint }}>
        <View style={{ height: 7, borderRadius: 4, width: `${pct * 100}%`, backgroundColor: C.cobalt }} />
      </View>
    </View>
  );
}

const DIMENSION_LABEL: Record<FacilitationDimension, string> = {
  rhythm: "Rhythm",
  accountability: "Accountability",
  alignment: "Alignment",
  positive_framing: "Positive framing",
};

function Moments({ title, items }: { title: string; items: FacilitationMoment[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <View>
      <Text style={s.h3} minPresenceAhead={50}>
        {title}
      </Text>
      {items.map((m, i) => (
        <View key={i} style={s.cardSand} wrap={false}>
          <Text style={{ fontFamily: "Figtree", fontWeight: 600, color: C.navy }}>{m.quote}</Text>
          {m.context ? <Text style={[s.muted, s.small]}>{m.context}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------
// The document
// ---------------------------------------------------------------

export function overallFor(row: LeadAnalysisRow): OverallScore | null {
  return computeOverall({
    positive_framing: row.score_positive_framing,
    accountability: row.score_accountability,
    rhythm: row.score_rhythm,
    alignment: row.score_alignment,
    agenda: row.score_agenda,
  });
}

export function LeadReport({ row }: { row: LeadAnalysisRow }) {
  registerFonts();
  const review: FacilitationReview | null = row.facilitation_review_json;
  const scored = review && !review.insufficient_transcript ? review : null;
  const overall = scored ? overallFor(row) : null;
  const quality = commitmentQuality(row.commitments_json);
  const dated = new Date(row.completed_at ?? row.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const sections = splitSections(row.analysis_markdown ?? "");
  const opened = (review?.opening_questions ?? []).filter(
    (q): q is { asker: string; asked: string; opened: string } =>
      typeof q.asked === "string" && typeof q.opened === "string"
  );

  return (
    <Document
      title={`Meeting Analysis: ${row.company_name}`}
      author="The AiMS Institute"
      subject={`Prepared for ${row.full_name}, ${row.company_name}`}
      creator="The AiMS Institute"
      producer="The AiMS Institute"
    >
      {/* ---- Cover ---- */}
      <Page size="LETTER" style={{ backgroundColor: C.navy, fontFamily: "Inter", color: C.white }}>
        <Svg viewBox="0 0 612 792" style={{ position: "absolute", top: 0, left: 0, width: 612, height: 792 }}>
          <Defs>
            <LinearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={C.navy} />
              <Stop offset="55%" stopColor={C.navyMid} />
              <Stop offset="100%" stopColor={C.cobalt} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="612" height="792" fill="url(#brand)" />
        </Svg>
        <View style={{ padding: 60, flex: 1, justifyContent: "space-between" }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
          <Image src={path.join(ASSETS, "logo-white.png")} style={{ width: 120, height: 120, marginLeft: -6 }} />
          <View>
            <Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.2, textTransform: "uppercase", color: C.sky, marginBottom: 14 }}>
              The AiMS Institute
            </Text>
            <Text style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.12 }}>
              Leadership Meeting Analysis
            </Text>
            <View style={{ width: 90, height: 4, borderRadius: 2, backgroundColor: C.chartreuse, marginTop: 18, marginBottom: 22 }} />
            <Text style={{ fontFamily: "Figtree", fontSize: 15, fontWeight: 600 }}>
              Prepared for {row.full_name}, {row.company_name}
            </Text>
            <Text style={{ fontFamily: "Figtree", fontSize: 11, color: C.sky, marginTop: 6 }}>{dated}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {overall ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  width: 170,
                }}
              >
                <Text style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: C.sky }}>
                  Facilitation score
                </Text>
                <Text style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, marginTop: 4 }}>
                  {overall.oneDecimal}
                  <Text style={{ fontSize: 14, fontWeight: 600, color: C.sky }}> / 10</Text>
                </Text>
              </View>
            ) : null}
            {quality.total > 0 ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  width: 170,
                }}
              >
                <Text style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: C.sky }}>
                  Clear commitments
                </Text>
                <Text style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, marginTop: 4 }}>
                  {quality.clear}
                  <Text style={{ fontSize: 14, fontWeight: 600, color: C.sky }}> of {quality.total}</Text>
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Page>

      {/* ---- At a glance ---- */}
      <PageFrame row={row} section="At a glance">
        <SectionTitle eyebrow="At a glance" title="The Meeting in One Page" />
        {review?.executive_summary ? (
          <Text style={{ fontFamily: "Figtree", fontSize: 13, lineHeight: 1.5, color: C.navy, marginBottom: 16 }}>
            {review.executive_summary}
          </Text>
        ) : null}
        {review?.insufficient_transcript ? (
          <View style={s.cardSand}>
            <Text>
              {review.missing_context ??
                "The transcript was too short or too sparse for a full read of how the meeting ran."}
            </Text>
          </View>
        ) : null}
        {overall ? (
          <View style={[s.card, { padding: 16 }]} wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 12 }}>
              <Text style={{ fontFamily: "Inter", fontSize: 34, fontWeight: 800, color: C.navy, letterSpacing: -1, lineHeight: 1 }}>
                {overall.oneDecimal}
              </Text>
              <Text style={{ fontFamily: "Inter", fontSize: 12, fontWeight: 600, color: C.faint, marginLeft: 4, marginBottom: 3 }}>
                / 10 facilitation score
              </Text>
            </View>
            {overall.lines.map((l) => (
              <ScoreBar key={l.key} label={l.label} raw={l.raw} outOf={l.outOf} weight={l.weight} />
            ))}
            <Text style={[s.muted, { fontSize: 8.5, marginTop: 2 }]}>
              The score is a weighted average of five parts. Agenda sections is scored out of 5 and doubled to match the others.
            </Text>
          </View>
        ) : review?.score_withheld ? (
          <View style={s.cardSand}>
            <Text>No score for this meeting. The review left out part of what the score is built from, so only the notes are shown.</Text>
          </View>
        ) : null}

        {scored ? (
          <View>
            <Text style={s.h2} minPresenceAhead={60}>
              What Each Part Measures
            </Text>
            {(
              [
                ["positive_framing", scored.dimensions.positive_framing?.notes],
                ["accountability", scored.dimensions.accountability.notes],
                ["rhythm", scored.dimensions.rhythm.notes],
                ["alignment", scored.dimensions.alignment.notes],
                ["agenda", scored.agenda_adherence.notes],
              ] as const
            ).map(([key, notes]) => (
              <View key={key} style={{ marginBottom: 8 }} wrap={false}>
                <Text style={s.cardTitle}>
                  {key === "agenda" ? "Agenda sections" : DIMENSION_LABEL[key as FacilitationDimension]}
                </Text>
                <Text style={[s.muted, s.small]}>{SCORE_PART_DESCRIPTIONS[key]}</Text>
                {notes ? <Text style={{ marginTop: 3 }}>{notes}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </PageFrame>

      {/* ---- Meeting analysis ---- */}
      {sections.length > 0 ? (
        <PageFrame row={row} section="Meeting analysis">
          <SectionTitle eyebrow="Meeting analysis" title="What Happened in the Meeting" />
          {row.truncated ? (
            <View style={s.cardSand}>
              <Text>This summary was cut short before it finished. The scores and coaching notes are complete.</Text>
            </View>
          ) : null}
          {sections.map((sec, i) => (
            <View key={i}>
              {sec.title ? (
                <Text style={s.h2} minPresenceAhead={60}>
                  {sec.title}
                </Text>
              ) : null}
              <Markdown blocks={parseMarkdown(sec.body)} />
            </View>
          ))}
        </PageFrame>
      ) : null}

      {/* ---- Commitment quality and open issues ---- */}
      <PageFrame row={row} section="Commitments">
        <SectionTitle eyebrow="Commitment quality" title="What the Team Committed To" />
        <Text style={{ marginBottom: 12 }}>
          A commitment is clear when it has a deadline and a definition of done: anyone in the room could tell, on the day, whether it happened.
        </Text>
        {quality.total > 0 ? (
          <>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }} wrap={false}>
              {(
                [
                  ["Clear on both", quality.clear],
                  ["Had a deadline", quality.withDeadline],
                  ["Had a definition of done", quality.withDoneDefined],
                ] as const
              ).map(([label, n]) => (
                <View key={label} style={[s.cardSand, { flex: 1, marginBottom: 0 }]}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={{ fontFamily: "Inter", fontSize: 22, fontWeight: 800, color: C.navy, marginTop: 2 }}>
                    {n}
                    <Text style={{ fontSize: 11, fontWeight: 600, color: C.faint }}> of {quality.total}</Text>
                  </Text>
                </View>
              ))}
            </View>
            {row.commitments_json.map((c, i) => (
              <View key={i} style={s.card} wrap={false}>
                <Text style={s.cardTitle}>{c.description}</Text>
                <Text style={[s.muted, s.small, { marginBottom: 6 }]}>
                  {c.owner ?? "No owner named"}
                  {c.due_phrase ? ` · ${c.due_phrase}` : ""}
                </Text>
                <View style={{ flexDirection: "row" }}>
                  <Check on={c.clarity_timeline} label={c.clarity_timeline ? "Deadline" : "No clear deadline"} />
                  <Check on={c.clarity_success} label={c.clarity_success ? "Done is defined" : "Done is not defined"} />
                </View>
                {c.clarity_note ? (
                  <View style={{ marginTop: 7, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: C.chartreuse }}>
                    <Text style={s.label}>A clearer version</Text>
                    <Text style={{ marginTop: 1 }}>{c.clarity_note}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <View style={s.cardSand}>
            <Text>No commitments came out of this meeting. Nobody left with something to do, a name beside it, and a date.</Text>
          </View>
        )}

        {row.issues_json.length > 0 ? (
          <View>
            <Text style={s.h2} minPresenceAhead={60}>
              Left Open
            </Text>
            <Text style={[s.muted, { marginBottom: 8 }]}>
              Problems and questions the team raised and did not resolve in the meeting.
            </Text>
            {row.issues_json.map((iss, i) => (
              <View key={i} style={s.listRow} wrap={false}>
                <Text style={s.bullet}>{"•"}</Text>
                <Text style={s.listText}>{iss.title}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </PageFrame>

      {/* ---- Coaching notes ---- */}
      {scored ? (
        <PageFrame row={row} section="Coaching notes">
          <SectionTitle eyebrow="Coaching notes" title="How the Meeting Was Run" />

          {scored.strengths.length > 0 ? (
            <View>
              <Text style={s.h2} minPresenceAhead={60}>
                What Worked
              </Text>
              {scored.strengths.map((x, i) => (
                <View key={i} style={[s.card, { borderLeftWidth: 3, borderLeftColor: C.success }]} wrap={false}>
                  <Text style={s.cardTitle}>{x.title}</Text>
                  {x.evidence ? <Text style={[s.muted, s.small]}>{x.evidence}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {scored.growth_edges.length > 0 ? (
            <View>
              <Text style={s.h2} minPresenceAhead={60}>
                Growth Edges
              </Text>
              {scored.growth_edges.map((g, i) => (
                <View key={i} style={[s.card, { borderLeftWidth: 3, borderLeftColor: C.sky }]} wrap={false}>
                  <Text style={s.label}>{DIMENSION_LABEL[g.dimension] ?? g.dimension}</Text>
                  <Text style={[s.cardTitle, { marginTop: 2 }]}>{g.title}</Text>
                  {g.evidence ? <Text style={[s.muted, s.small]}>{g.evidence}</Text> : null}
                  {g.why_it_matters ? <Text style={{ marginTop: 3 }}>{g.why_it_matters}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {scored.experiments.length > 0 ? (
            <View>
              <Text style={s.h2} minPresenceAhead={60}>
                What to Try Next Week
              </Text>
              {scored.experiments.map((e, i) => (
                <View key={i} style={[s.cardSand, { borderLeftWidth: 3, borderLeftColor: C.chartreuse }]} wrap={false}>
                  <Text style={s.cardTitle}>{e.action}</Text>
                  {e.why ? (
                    <Text style={s.small}>
                      <Text style={s.bold}>Why: </Text>
                      {e.why}
                    </Text>
                  ) : null}
                  {e.next_step ? (
                    <Text style={[s.small, { marginTop: 2 }]}>
                      <Text style={s.bold}>Try: </Text>
                      {e.next_step}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {(scored.next_week_questions ?? []).length > 0 ? (
            <View>
              <Text style={s.h2} minPresenceAhead={60}>
                Questions Worth Asking Next Week
              </Text>
              <Text style={[s.muted, s.small, { marginBottom: 8 }]}>
                A generative question starts from something that went well and asks where it could go next. These are that kind.
              </Text>
              {(scored.next_week_questions ?? []).map((q, i) => (
                <View key={i} style={s.card} wrap={false}>
                  <Text style={[s.cardTitle, { fontFamily: "Figtree", fontSize: 11.5 }]}>{q.question}</Text>
                  {q.moment ? <Text style={[s.muted, s.small]}>From: {q.moment}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {opened.length > 0 ? (
            <View>
              <Text style={s.h2} minPresenceAhead={60}>
                Questions That Opened Things Up
              </Text>
              {opened.map((q, i) => (
                <View key={i} style={s.cardSand} wrap={false}>
                  <Text style={s.cardTitle}>
                    {q.asker} asked {q.asked}.
                  </Text>
                  <Text style={s.small}>{q.opened}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Moments title="Appreciation in the Room" items={scored.appreciation_moments} />
          <Moments title="Generative Questions Asked" items={scored.generative_questions} />
          <Moments title="Reframes" items={scored.reframes} />

          {scored.fourws_audit.length > 0 ? (
            // Kept on one page when it fits, so no row lands on a page
            // without the column names above it.
            <View wrap={scored.fourws_audit.length > 8} break={false}>
              <Text style={s.h2} minPresenceAhead={80}>
                4Ws Audit
              </Text>
              <Text style={[s.muted, s.small, { marginBottom: 8 }]}>
                For each issue the meeting worked through, which of the four steps it reached: What is happening, what we Want instead, the Way we will get there, and Who does it by When. Where a step was missed, the note is a question to ask next time.
              </Text>
              <View style={{ flexDirection: "row", paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={[s.label, { flex: 1 }]}>Issue</Text>
                {["What", "Want", "Way", "Who/When"].map((h) => (
                  <Text key={h} style={[s.label, { width: 52, textAlign: "center", letterSpacing: 0.4 }]}>
                    {h}
                  </Text>
                ))}
              </View>
              {scored.fourws_audit.map((r, i) => (
                <View
                  key={i}
                  style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}
                  wrap={false}
                >
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontWeight: 600, color: C.navy }}>{r.issue}</Text>
                    {r.note ? <Text style={[s.muted, s.small]}>{r.note}</Text> : null}
                  </View>
                  {[r.has_what, r.has_want, r.has_way, r.has_who_when].map((hit, j) => (
                    <View key={j} style={{ width: 52, alignItems: "center", paddingTop: 3 }}>
                      <Dot on={hit} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </PageFrame>
      ) : null}

      {/* ---- About ---- */}
      <PageFrame row={row} section="About this analysis">
        <SectionTitle eyebrow="About this analysis" title="How This Was Put Together" />
        <Text style={s.p}>
          This analysis reads the transcript of one leadership team meeting against the AiMS weekly leadership meeting model. It looks at how the meeting was run as much as what it covered: whether the team started from what is working, whether the meeting followed a steady rhythm, whether the discussion connected to where the business is going, and whether the conversation turned into commitments someone owns.
        </Text>
        <Text style={s.h3}>The AiMS weekly leadership meeting</Text>
        <Text style={s.p}>
          Five sections, in order: Positive Check-In, Functional Updates, Forward Momentum on Strategy, Solve, Together, and Review Commitments. Each has its own job, and strong meetings give each its own time rather than letting updates take over.
        </Text>
        <Text style={s.h3}>What a transcript can and cannot show</Text>
        <Text style={s.p}>
          A transcript captures what was said, not tone of voice, what happened before the meeting, or what the team already knows. Treat this as one careful outside read of one meeting: a place to start a conversation, not a verdict on the team.
        </Text>
      </PageFrame>
    </Document>
  );
}
