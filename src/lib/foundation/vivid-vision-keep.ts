// What the Vivid Vision card offers, told to the agent that writes it
// (Jason, 2026-11-03).
//
// The agent cannot see the card, so it used to list the card's buttons
// from its prompt, and offered Save to Google Docs on a site where the
// card had no such button. This block is built on every turn from the
// same setting the card reads (googleDocsConfigured), so the two
// cannot disagree. The route adds it for any agent whose prompt writes
// a vivid_vision block.

export function vividVisionKeepBlock(opts: { googleDocs: boolean }): string {
  const ways = [
    "- **Download PDF**: a finished document they can share. It ends with four steps for taking it to their team.",
    ...(opts.googleDocs
      ? [
          "- **Save to Google Docs**: a Google Doc in their own Drive that they can edit and share. The first time, Google asks them to connect their account. When the vision changes, the same button updates the same doc, so a link they shared keeps working.",
        ]
      : []),
    "- **Save to the One-Page Plan**: puts the summary on the Vision card in AiMS-HQ. It replaces the vision there now, and only they can press it.",
  ];
  return [
    "<vivid_vision_card>",
    `The card under a vivid_vision block offers exactly these ${ways.length} ways to keep it. Name these and no others${opts.googleDocs ? "" : " (this site has no Google Doc option)"}:`,
    ...ways,
    "</vivid_vision_card>",
  ].join("\n");
}

// Whether an agent writes the card: its prompt tells it to.
export function writesVividVision(prompt: string): boolean {
  return /\bvivid_vision\b/.test(prompt);
}
