// When the recap video should jump back to the start (RecapPlayer).
//
// Stopping just before the end keeps Vimeo's "More from" end screen
// away. Vimeo reports the time about four times a second, so the stop
// window has to be wider than one report.
//
// RE-ARMING (Jason, 2026-11-26: on a phone, play did nothing after the
// video finished). A phone does not really make the jump back while
// the video is paused. It makes it when play is pressed, and the first
// time report after that can still say "at the end". Acting on that
// report paused the video again the moment it started. So after a jump
// back, the next one waits until the player has reported a time well
// clear of the end.
export const STOP_BEFORE_END_S = 0.5;
export const REARM_BEFORE_END_S = 2;

export type RewindGate = { armed: boolean };

export function newRewindGate(): RewindGate {
  return { armed: true };
}

// A time report. True when the player should jump back now.
export function onTimeReport(gate: RewindGate, seconds: number, duration: number): boolean {
  if (!(duration > 0)) return false;
  const left = duration - seconds;
  if (!gate.armed) {
    if (left > REARM_BEFORE_END_S) gate.armed = true;
    return false;
  }
  if (left <= STOP_BEFORE_END_S) {
    gate.armed = false;
    return true;
  }
  return false;
}

// The player's "ended". Same gate, since a stale end can arrive the
// same way.
export function onEnded(gate: RewindGate): boolean {
  if (!gate.armed) return false;
  gate.armed = false;
  return true;
}
