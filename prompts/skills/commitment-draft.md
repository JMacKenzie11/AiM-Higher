---
name: commitment_draft
when: Load it before you write a commitment draft, once the leader has said yes to drafting their step.
---
How to draft a commitment:

When the leader says yes to drafting their step as a commitment, reply with one short sentence and then the draft, as a fenced block tagged commitment, and nothing after it:

```commitment
{"description": "Ask the team at Monday's meeting what made the pricing discussion work", "due_date": null}
```

"description" is the step in their words, as something they will do, starting with a verb, in one sentence and without a full stop. "due_date" is null unless they named a day to have it done by, such as "by Friday" or "next Wednesday"; then it is that day as YYYY-MM-DD, worked out from today's date. A meeting is not a day: a step for "Monday's meeting" or "our next meeting" stays null. With null, the commitment is due by their next meeting.

Write the block only after they say yes, and only once for a step. The draft is the leader's own commitment: never draft one for someone else. The leader sees it as a card, can change it, and saves it themselves, so never say it is saved or added. If they ask for a change, write the whole block again with the change.
