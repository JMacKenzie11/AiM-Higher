// Drive URL parsing, deliberately in its own module with ZERO
// dependencies.
//
// This used to live in google-drive.ts, which imports the `googleapis`
// package (202MB on disk, 328 API surfaces, of which this codebase
// uses two). Because src/lib/transcripts/actions.ts imported the
// parser at module top level, every consumer of that actions file
// pulled the whole Google API tree into its module graph — six admin
// routes plus their server actions, none of which touch Drive at
// request time. The build's dependency tracer then had to walk that
// tree once per route entry.
//
// The rule for this file: no imports, ever. If it needs a dependency,
// it belongs somewhere else.

// Parses a folder id from a raw Drive URL or from the id itself.
export function parseGoogleFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const foldersMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]{20,})/);
  if (foldersMatch) return foldersMatch[1];
  const idParam = trimmed.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (idParam) return idParam[1];
  return null;
}
