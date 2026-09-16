import type { AnnualGoal, StrategicFocusArea } from "@/lib/types";
import { formatParentRef, NO_PARENT } from "@/lib/plan/parent-ref";

// The options inside every "what does this priority sit under?"
// picker. One list, two levels, grouped — because a priority hangs
// off a goal OR off a focus area directly, and asking that as two
// controls would let a reader answer both.
//
// Rendered from `formatParentRef` so the option values and the
// server action's parser cannot drift apart (see parent-ref.ts).
export function PriorityParentOptions({
  goalOptions,
  sfaOptions,
}: {
  goalOptions: Pick<AnnualGoal, "id" | "title">[];
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
}) {
  return (
    <>
      <option value={NO_PARENT}>Not linked (yet)</option>
      {goalOptions.length > 0 ? (
        <optgroup label="Goals">
          {goalOptions.map((option) => (
            <option
              key={option.id}
              value={formatParentRef({ kind: "goal", id: option.id })}
            >
              {option.title}
            </option>
          ))}
        </optgroup>
      ) : null}
      {sfaOptions.length > 0 ? (
        <optgroup label="Focus areas">
          {sfaOptions.map((option) => (
            <option
              key={option.id}
              value={formatParentRef({ kind: "sfa", id: option.id })}
            >
              {option.title}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}
