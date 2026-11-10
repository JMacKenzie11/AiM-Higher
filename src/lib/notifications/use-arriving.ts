"use client";

import { useEffect, useState } from "react";

// A VALUE THE SERVER IS STILL WORKING OUT WHEN THE PAGE IS SENT.
//
// The (app) layout used to wait for the notifications before it sent
// anything, so every page in the product, and every loading skeleton,
// was held up by the bell. Now the layout hands the bell and Aimee's
// icon a promise and sends the page straight away; the list follows on
// the same response a moment later.
//
// This reads such a promise without suspending: it gives `initial`
// until the value arrives, then the value. On a later refresh a new
// promise comes down, and the previous value stays on screen until the
// new one lands, so a count never blinks to nothing and back. A plain
// value is passed straight through.
function isThenable<T>(v: T | PromiseLike<T>): v is PromiseLike<T> {
  return typeof (v as { then?: unknown } | null)?.then === "function";
}

export function useArriving<T>(source: T | PromiseLike<T>, initial: T): T {
  const [value, setValue] = useState<T>(isThenable(source) ? initial : source);
  useEffect(() => {
    if (!isThenable(source)) {
      setValue(source);
      return;
    }
    let live = true;
    source.then(
      (v) => {
        if (live) setValue(v);
      },
      // The layout already turns a failed read into an empty list and
      // logs it; nothing to show here.
      () => {}
    );
    return () => {
      live = false;
    };
  }, [source]);
  return value;
}
