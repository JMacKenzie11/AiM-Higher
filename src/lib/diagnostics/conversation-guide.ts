// The conversation guide (Capacity Diagnostic build spec), shown on the
// Conversations step and walked by the conversation helper. Kept apart
// from conversation.ts so the page's client code can import it without
// the voice checks.

export const CONVERSATION_GUIDE = [
  "Tell me about a time in the last year when you finished a day here feeling like you had done your best work. What were you doing, and what did you bring to it that made it go well?",
  "Which parts of your week get in the way of more days like that?",
  "If a tool handled the first draft, the lookup, or the paperwork on one of those, what would it have to get right for you to use it?",
  "What would you want the owner to understand about how your work actually happens?",
  "With a few hours back each week, what is the first thing you would put them toward?",
] as const;

export const OPENING_LINE =
  "What you tell me stays with me. The owner sees combined results, never your individual ratings or answers.";

// The heading each answer goes under in the notes.
export const QUESTION_LABELS = ["Best work", "What gets in the way", "What a tool would have to get right", "How the work happens", "Where the hours would go"] as const;
