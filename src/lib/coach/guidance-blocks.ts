// The strengths and memory blocks on the latest user turn, each followed
// by the guidance for it (guidance.ts; Jason, 2026-11-26).
//
// WHEN EACH ARRIVES:
// - Strengths guidance: whenever there is a strengths block. Practices
//   never get one (context.ts), so this is about-mode only in practice.
// - Memory guidance: whenever there is a memory block, unless the
//   conversation runs on the voice-only base. Those agents never had the
//   coach prompt the guidance came from, so they keep what they had.
// No block, no guidance: nothing new reaches a conversation that did not
// have the data.
export type Guidance = { strengths: string; memory: string };

export function dataBlocks(args: {
  strengthsContext: string | null;
  memoryContext: string | null;
  voiceOnly: boolean;
  guidance: Guidance;
}): { strengthsBlock: string; memoryBlock: string } {
  const { strengthsContext, memoryContext, voiceOnly, guidance } = args;
  const strengthsBlock = strengthsContext ? `${strengthsContext}\n\n${guidance.strengths}\n\n` : "";
  const memoryBlock = memoryContext
    ? voiceOnly
      ? `${memoryContext}\n\n`
      : `${memoryContext}\n\n${guidance.memory}\n\n`
    : "";
  return { strengthsBlock, memoryBlock };
}
