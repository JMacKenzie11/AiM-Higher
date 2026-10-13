// How a commitment's quality is judged: a clear deadline and a clear
// definition of done, with a suggested rewrite when either is missing.
//
// One wording, read by two pipelines: the client meeting analysis
// (analyze.ts, the extraction call) and the free lead analysis
// (lead-analysis/analyze.ts). The Commitments page's clarity dot and
// the lead report's Commitment quality section are the same judgement,
// and keeping one copy is what keeps them the same.
export const COMMITMENT_CLARITY_RULES = `For every extracted commitment, also score it on two clarity criteria (each is a boolean answered from the transcript alone — do not assume information the participants didn't state):
- clarity_timeline: TRUE only when a specific deadline was stated or a "by end of week / by Friday" style anchor was agreed. Vague "soon" or "next few weeks" is FALSE.
- clarity_success:  TRUE when the commitment names an observable outcome or artefact that will show it was fulfilled. Action verbs that produce a concrete artefact — "schedule", "send", "publish", "draft", "share", "post", "create", "assign", "book", "invite", "write", "email", "review and approve" — count as TRUE even when the verb is short, because the artefact (the invite, the document, the message) either exists or doesn't. Only mark FALSE for genuinely vague verbs with no artefact — "look into", "think about", "explore", "consider", "keep in mind", "reflect on". Assess clarity_success independently of clarity_timeline; a missing deadline never makes the success check FALSE by itself.

When either is FALSE, provide a short (≤160 char) refinement suggestion in clarity_note that rewrites the commitment to satisfy both. When both are TRUE, set clarity_note to null.`;
