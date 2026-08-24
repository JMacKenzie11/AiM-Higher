"use client";

import { useEffect } from "react";
import { trackClient } from "./track-client";

// Fires a single analytics event when the wrapping route mounts.
// Used for "page opened" style events on server-rendered pages
// where we can't call the client SDK directly. Deps are the event
// name + a stringified properties bag so the effect refires only
// when the *identity* of what we're tracking changes (e.g.,
// navigating from one priority to another rerenders the layout
// with a different priority_id and legitimately counts as a new
// open).

export function TrackOnMount({
  event,
  properties,
}: {
  event: string;
  properties?: Record<string, unknown>;
}) {
  const propsKey = properties ? JSON.stringify(properties) : "";
  useEffect(() => {
    trackClient(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, propsKey]);
  return null;
}
