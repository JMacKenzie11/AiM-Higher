# Keeping Aimee fast and lean

Standing rules for any change to Aimee: the coach route
(`src/app/api/coach/route.ts`, `src/lib/coach/turn/`), her instructions
(`prompts/leadership-coach.md`, `prompts/guidance/*.md`, `prompts/aims-voice.md`,
`src/lib/coach/general-preamble.ts`, `src/lib/coach/voice-rules.ts`,
`src/lib/voice/core.ts`, the agents' prompts), her tools and her memory.
Jason, 2026-11-14: "whenever we make any changes to Aimee ... she stays
as optimized as possible", always with an excellent experience for the
person using her.

Each rule says what enforces it. Where a test enforces it, the test
names this file.

## Instructions

1. **Measure every instruction change.** Run `npm run eval:aimee --
   before /tmp 2` on main and `npm run eval:aimee -- after /tmp 2` on the
   branch, three times a side (one run varies a lot: 10 vs 15 sent back
   on the same prompt). Put both summaries in the PR. A change that
   raises "sent back" or rule breaks does not ship, however tidy it
   looks. *Enforced by review; the script is
   `scripts/aimee-first-reply-eval.mts`.*
2. **Instructions grow only by decision.** Each kind of conversation has
   a character budget (`aimee-budget.test.ts`). Going over means raising
   the budget in the same PR, with the eval's numbers saying why.
3. **One home for a rule that can conflict.** A rule about data,
   lookups, lists or what to remember is said where it belongs and
   nowhere else. Copies drift apart and then argue (the 2026-11-13
   "Dalton" chat). *`aimee-budget.test.ts` checks the ones that have.*
4. **Keep a repeat that measurably helps.** The preamble repeats "one
   question" and "no actually in a question" from the voice rules;
   removing the repeat took first replies sent back from 33% to 52%.
   Remove a repeat only with the eval showing no rise.
5. **Nothing in the system prompt changes by the day or by the person
   asking**, except the per-person blocks appended after the shared
   part. Dates, memory, page context and the company's record ride on
   the latest user message. *`route-characterisation.test.ts` fails on
   a date in the system prompt.*
6. **The instructions follow their own rules.** Do not write "rather
   than", "That's…" or "actually" into a prompt that tells Aimee not to.

## Every turn

7. **Set up once.** React's `cache()` does not memoise in a route
   handler. Pass the session, the help viewer and the help docs along
   instead of looking them up again, and run independent reads together
   (`turn/setup.ts`). *`route-characterisation.test.ts`: a turn never
   signs the person in again.*
8. **Everything sent twice is cached.** The system prompt carries a
   cache mark, and `withCacheMarks` marks the conversation for tool
   passes, the retry and the next message. A new model call on the turn
   (another retry, another pass) uses the same tools, system block and
   marks. Three of the API's four marks are in use. *Pinned in
   `route-characterisation.test.ts`.*
9. **Thinking has room.** The coach models think by default, out of the
   same `max_tokens`. A cap must leave room for thinking plus the
   answer: the turn is 8000, the memory summary 4096, short calls ask
   for no thinking (`callSettings(model, "off")`). A reply cut off at
   the cap is reported, never saved as if whole.
10. **The person never waits on bookkeeping.** Titles, usage rows, rule
    counts and analytics run after the reply and never fail it. The
    memory sweep is a request (`/api/coach/memory/sweep`), not a server
    action, because server actions queue behind each other.
11. **Measure, then optimise.** `coach.turn_shape` carries
    `pre_stream_ms`, `first_text_ms`, `total_ms` and `retried`. Quote
    those before and after a speed change.

## Safety nets

12. **Behaviour is pinned before it is moved.** A change to what a turn
    does updates `route-characterisation.test.ts` on purpose, in the PR
    that makes it. Prompt hashes are regenerated only for a deliberate
    instruction change.
13. **Run Aimee's real-model tests** before merging a change to her: 
    `aimee-panel`, `aimee-named-person`, `aimee-record-for-its-people`,
    `aimee-session-offers`, `aimee-live-state`, `coach-history`,
    `coach-memory`, `aimee-panel-memory` (`npm run e2e:build`, then
    `E2E_PROD=1 npx playwright test <specs> --workers=1`). A failure
    gets a cause, never a rerun (memory tests must wait for the sweep
    request; wording checks accept every honest phrasing).

## Guidance that comes with its data

14. **A rule about a data block rides with the block.** How to use a
    strengths profile, and how to voice each kind of memory note, sit
    in `prompts/guidance/` and arrive right after their block, only
    when it is there (`lib/coach/guidance-blocks.ts`). A rule that must
    hold without the block (never invent strengths, never claim a
    memory you were not given) stays in the base. *Enforced by
    `guidance-blocks.test.ts`: every moved rule arrives with its
    block, none without it, none twice.*

