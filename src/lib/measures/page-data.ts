import "server-only";

import { buildBoardData, type BoardData } from "@/lib/measures/board";
import {
  buildMeasuresTree,
  type MeasureTreeFunction,
} from "@/lib/measures/service";
import { loadMeasuresSpine } from "@/lib/measures/spine";

// Everything /measures renders, from one pass over the database.
//
// WHY ONE FUNCTION RETURNING BOTH SHAPES, rather than a shared loader
// the page calls before two builders.
//
// The page never wants one without the other. Both are always
// computed, both land on the same paint, and they are handed to two
// components side by side. There is no caller, and no plausible
// future caller, that wants the Board without the Manager on this
// route. So the single fetch is better expressed as a fact of the
// function's shape than as a convention the page has to remember: a
// future edit cannot reintroduce the duplication by calling the two
// loaders separately, because the page no longer knows they exist.
//
// The shaping still lives in two pure builders. Each keeps its own
// tests, neither grows the other's concerns, and a third consumer
// (an export, a digest) can shape the same spine without another
// read.
//
// The convenience wrappers getMeasuresTree and getBoardData remain
// for a caller that genuinely wants one shape alone. They load their
// own spine, which is correct in isolation and is exactly what this
// function exists to avoid doing twice.

export type MeasuresPageData = {
  tree: { functions: MeasureTreeFunction[]; weekEnding: string };
  board: BoardData;
};

export async function getMeasuresPageData(
  companyId: string,
  userId: string,
  timezone: string,
  includeAll: boolean
): Promise<MeasuresPageData> {
  const spine = await loadMeasuresSpine(companyId, timezone);
  return {
    tree: buildMeasuresTree(spine, userId, includeAll),
    board: buildBoardData(spine),
  };
}
