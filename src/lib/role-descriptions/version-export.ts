import type { RdDocument } from "./generate";
import {
  parseRoleDescription,
  type RoleDescriptionDoc,
} from "./parse-document";

// Which document a published version's .docx is built from.
//
// A version carries one of two documents. The Role Description
// Creator writes body_json and leaves snapshot_document as {} (the
// column is NOT NULL from 0129). The generator fills
// snapshot_document and leaves body_json null. The version page
// already reads them that way; the download read snapshot_document
// for both, and the generator's builder walks its enrichment arrays,
// so a Creator version's Download threw on {} and showed an error
// page instead of a file.
//
// Kept pure so the choice is testable without a database.

export type VersionExportSource =
  | { kind: "agent"; doc: RoleDescriptionDoc }
  | { kind: "generated"; doc: RdDocument | null };

export function versionExportSource(snap: {
  bodyJson: unknown | null;
  snapshotDocument: unknown;
}): VersionExportSource {
  if (snap.bodyJson !== null && snap.bodyJson !== undefined) {
    const doc = parseRoleDescription(JSON.stringify(snap.bodyJson));
    if (doc) return { kind: "agent", doc };
  }
  // A snapshot without the generator's arrays is not a generator
  // document. Null makes the builder lay the file out from the
  // chart alone, which is a file rather than a crash.
  return {
    kind: "generated",
    doc: isRdDocument(snap.snapshotDocument) ? snap.snapshotDocument : null,
  };
}

function isRdDocument(raw: unknown): raw is RdDocument {
  if (typeof raw !== "object" || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return (
    Array.isArray(o.outcomeEnrichments) &&
    Array.isArray(o.responsibilityEnrichments) &&
    typeof o.strengthsAndExpertise === "object" &&
    o.strengthsAndExpertise !== null &&
    typeof o.qualifications === "object" &&
    o.qualifications !== null
  );
}
