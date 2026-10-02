import { personalDetailMatcher } from "@/lib/voice/personal-detail";

// ANONYMOUS SUMMARIES OF CONVERSATIONS (Jason, 2026-10-01, decision 1
// of docs/investigations/open-data.md).
//
// Two nightly jobs read Aimee conversations so AiMS can improve Aimee:
// the coaching insights job (one summary per conversation) and the
// themes job (five themes across recent conversations). They stay,
// and they are anonymous:
//
//   BEFORE THE MODEL. Names are taken out of the text it is sent:
//     every person on the instance's roster (full name, first name,
//     last name) becomes "a colleague", every company name "the
//     company", and email addresses and phone numbers go too. The
//     roster is matched as written, capitalised and whole-word, so
//     "will" and "mark" in a sentence are left alone; a name that is
//     also a word and opens a sentence ("Will we make it?") is taken
//     out with it, which costs a word of meaning and keeps the rule.
//
//   BEFORE ANYTHING IS STORED. What the model wrote is checked in code
//     for a roster name, a role that identifies one person ("the
//     CEO", "the founder", "our only finance person") and a personal
//     detail (voice/personal-detail.ts). The caller sends it back once
//     naming what was wrong, and drops what still breaks the rule.
//
// What it cannot catch: a nickname, or a name that is not on the
// roster (a client, a spouse). The prompts carry that part. That is
// why the product says "anonymised summaries", and why the dashboard
// shows a company on its own only with enough people behind it
// (admin/insights-privacy.ts).

export type AnonymityFault = "a name" | "a role that identifies one person" | "a personal detail";

export type Anonymiser = {
  // The text with names, emails and phone numbers taken out.
  scrub: (text: string) => string;
  // What, if anything, in a piece of generated text breaks the rule.
  // Labels only: never the text, which is not logged.
  faults: (text: string) => AnonymityFault[];
};

const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const PHONE = /(?:\+?\d[\d ().-]{7,}\d)/g;

// Roles one person holds. "Owner" and "manager" are left out: a
// "process owner" or "a manager" names nobody.
const ONE_PERSON_ROLE =
  /\b(?:CEO|CFO|COO|CTO|CMO|CIO|CRO|CHRO|(?:co-?)?founder|president|vice president|managing director|general manager|head of [a-z]+|director of [a-z]+|(?:our|the|their) only [a-z]+)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole words, as written (capitalised), longest first so "Sam Lee"
// goes before "Sam". Null when there is nothing to match.
function namePattern(names: Iterable<string>): RegExp | null {
  const list = [...new Set([...names].map((n) => n.trim()).filter((n) => n.length >= 2 && /^\p{Lu}/u.test(n)))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return list.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null;
}

export function anonymiser(input: { people: readonly string[]; companies: readonly string[] }): Anonymiser {
  const personNames = new Set<string>();
  for (const full of input.people) {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    personNames.add(parts.join(" "));
    for (const part of parts) personNames.add(part);
  }
  const people = namePattern(personNames);
  const companies = namePattern(input.companies.map((c) => c.trim()).filter((c) => c.length >= 3));
  const personal = personalDetailMatcher({ mode: "record", people: input.people });

  return {
    scrub: (text) => {
      let out = text.replace(EMAIL, "an email address").replace(PHONE, "a phone number");
      if (companies) out = out.replace(companies, "the company");
      if (people) out = out.replace(people, "a colleague");
      return out;
    },
    faults: (text) => {
      const found: AnonymityFault[] = [];
      if ((people && new RegExp(people.source, "u").test(text)) || (companies && new RegExp(companies.source, "u").test(text))) {
        found.push("a name");
      }
      if (ONE_PERSON_ROLE.test(text)) found.push("a role that identifies one person");
      if (personal(text)) found.push("a personal detail");
      return found;
    },
  };
}

// The rule as both jobs' prompts state it.
export const ANONYMITY_RULE =
  "Never name anyone or any company. Leave out roles that identify one person (the CEO, the founder, our only finance person, the head of a department) and anything about anyone's health, family or private situation. Describe what the work was, not who did it.";
