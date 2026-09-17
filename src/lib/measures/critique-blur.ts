import type { FocusEvent } from "react";

// Should leaving this field run the draft critique?
//
// ---- THE BUG THIS FIXES ---------------------------------------
//
// Save and Cancel both needed clicking TWICE on the measure forms.
//
// The critique runs on blur. Clicking Save blurs the description
// field, the critique starts, `setCritiqueLoading(true)` re-renders,
// and the critique panel appears ABOVE the button row — which pushes
// the buttons down between `mousedown` and `mouseup`. The pointer is
// no longer over the button when the click completes, so no click
// lands. The second click works because the panel is already there
// and nothing moves.
//
// Nothing throws. The button simply does not respond, once, and then
// does. Which is exactly the kind of thing people stop reporting and
// start working around.
//
// ---- THE RULE -------------------------------------------------
//
// A critique exists to help somebody still writing. If they have
// reached for a button they have stopped writing, and the result
// would be thrown away a moment later along with the form. So: no
// critique when focus is moving to a button.
//
// That removes the re-render, which removes the shift, which is what
// was eating the click. It also stops an AI call nobody will read.
//
// relatedTarget is null when the blur has no new focus target — the
// window losing focus, a click on something unfocusable. Those are
// ordinary blurs and still critique, which is the behaviour that was
// there before.
//
// WORTH KNOWING: this fixes the trigger, not the underlying
// fragility. Any future state change on blur that re-renders content
// ABOVE the buttons will eat a click the same way. The durable fix is
// for the critique panel to not occupy layout above the action row;
// that is a bigger change to two forms and was not worth making for
// this.
export function shouldCritiqueOnBlur(
  event: Pick<FocusEvent<HTMLElement>, "relatedTarget">
): boolean {
  const next = event.relatedTarget as HTMLElement | null;
  if (!next) return true;
  // A <button>, or anything a browser reports as one: the submit
  // button, Cancel, and any icon action that lands in these forms
  // later without somebody having to remember this file exists.
  return next.tagName !== "BUTTON";
}
