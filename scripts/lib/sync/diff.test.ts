import { describe, it, expect } from "vitest";

import {
  diffTable,
  isNoOp,
  keyOf,
  planWrites,
  rowsDiffer,
  summarizeTable,
  type Row,
} from "./diff.ts";
import { classroom, type SyncTable } from "./datasets.ts";
import {
  assertNotCompanyScoped,
  assertNoStorageReferences,
  findStorageReferences,
  SyncRefused,
} from "./guards.ts";

// The diff decides what gets written into a live customer database,
// so it is tested as a pure function with no network anywhere near it.

const LESSONS: SyncTable = { table: "classroom_lessons", primaryKey: ["id"] };
const LESSON_TAGS: SyncTable = {
  table: "classroom_lesson_tags",
  primaryKey: ["lesson_id", "tag_id"],
};

const lesson = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  title: `Lesson ${id}`,
  sort_order: 1,
  published: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("diffTable", () => {
  it("inserts a source row the target does not have", () => {
    const d = diffTable({ spec: LESSONS, source: [lesson("a")], target: [] });
    expect(d.inserts.map((r) => r.id)).toEqual(["a"]);
    expect(d.updates).toEqual([]);
    expect(d.deletes).toEqual([]);
    expect(d.unchanged).toBe(0);
  });

  it("updates a row whose content differs", () => {
    const d = diffTable({
      spec: LESSONS,
      source: [lesson("a", { title: "New title" })],
      target: [lesson("a", { title: "Old title" })],
    });
    expect(d.updates.map((r) => r.title)).toEqual(["New title"]);
    expect(d.inserts).toEqual([]);
    expect(d.unchanged).toBe(0);
  });

  it("sends the whole row on update, not a patch", () => {
    // A patch would leave a column the source cleared still set on
    // the target, which is drift the mirror is supposed to remove.
    const d = diffTable({
      spec: LESSONS,
      source: [lesson("a", { description: null, title: "T" })],
      target: [lesson("a", { description: "stale", title: "was" })],
    });
    expect(d.updates[0]).toMatchObject({ id: "a", title: "T", description: null });
  });

  it("deletes a target row the source no longer has", () => {
    const d = diffTable({
      spec: LESSONS,
      source: [lesson("a")],
      target: [lesson("a"), lesson("b")],
    });
    expect(d.deletes).toEqual([{ id: "b" }]);
  });

  it("carries only the key columns on a delete", () => {
    const d = diffTable({ spec: LESSONS, source: [], target: [lesson("b")] });
    expect(Object.keys(d.deletes[0])).toEqual(["id"]);
  });

  it("reports an identical row as in sync", () => {
    const d = diffTable({
      spec: LESSONS,
      source: [lesson("a")],
      target: [lesson("a")],
    });
    expect(isNoOp(d)).toBe(true);
    expect(d.unchanged).toBe(1);
    expect(summarizeTable(d)).toBe("classroom_lessons: in sync (1 rows)");
  });

  it("ignores timestamps when deciding whether a row changed", () => {
    // Otherwise every run rewrites every row: updated_at moves the
    // moment the source is edited, and "changed" would come to mean
    // "touched" rather than "different".
    const d = diffTable({
      spec: LESSONS,
      source: [lesson("a", { updated_at: "2026-09-07T00:00:00Z" })],
      target: [lesson("a", { updated_at: "2026-01-01T00:00:00Z" })],
    });
    expect(d.updates).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it("compares jsonb by content, not by key order", () => {
    const spec: SyncTable = { table: "classroom_trainings", primaryKey: ["id"] };
    const a = { id: "t", body_json: { type: "doc", content: [{ a: 1, b: 2 }] } };
    const b = { id: "t", body_json: { content: [{ b: 2, a: 1 }], type: "doc" } };
    expect(rowsDiffer(a, b, spec)).toBe(false);
  });

  it("matches on a composite primary key", () => {
    const d = diffTable({
      spec: LESSON_TAGS,
      source: [{ lesson_id: "l1", tag_id: "t1" }],
      target: [{ lesson_id: "l1", tag_id: "t2" }],
    });
    expect(d.inserts).toEqual([{ lesson_id: "l1", tag_id: "t1" }]);
    expect(d.deletes).toEqual([{ lesson_id: "l1", tag_id: "t2" }]);
  });

  it("does not collide composite keys that concatenate the same", () => {
    // ("a","bc") and ("ab","c") are different rows.
    expect(keyOf({ lesson_id: "a", tag_id: "bc" }, ["lesson_id", "tag_id"]))
      .not.toBe(keyOf({ lesson_id: "ab", tag_id: "c" }, ["lesson_id", "tag_id"]));
  });

  it("never reads or writes an excluded column", () => {
    const spec: SyncTable = {
      table: "t",
      primaryKey: ["id"],
      excludeColumns: ["secret"],
    };
    const d = diffTable({
      spec,
      source: [{ id: "a", name: "n", secret: "source" }],
      target: [{ id: "a", name: "n", secret: "target" }],
    });
    // Differs only in the excluded column, so it is unchanged...
    expect(d.updates).toEqual([]);
    // ...and when it does change, the column is not written.
    const changed = diffTable({
      spec,
      source: [{ id: "a", name: "new", secret: "source" }],
      target: [{ id: "a", name: "old", secret: "target" }],
    });
    expect(changed.updates[0]).toEqual({ id: "a", name: "new" });
  });
});

describe("planWrites: dependency ordering", () => {
  const order = ["categories", "lessons", "trainings"];
  const diffs = order.map((t) => ({
    table: t,
    inserts: [{ id: t }],
    updates: [],
    deletes: [{ id: t }],
    unchanged: 0,
  }));

  it("writes parents before children", () => {
    expect(planWrites(diffs).upserts.map((d) => d.table)).toEqual(order);
  });

  it("deletes children before parents", () => {
    // A parent removed while a child still points at it is a foreign
    // key violation, so deletes run in reverse.
    expect(planWrites(diffs).deletes.map((d) => d.table)).toEqual([
      "trainings",
      "lessons",
      "categories",
    ]);
  });

  it("omits tables with nothing to do from both lists", () => {
    const quiet = [
      { table: "a", inserts: [], updates: [], deletes: [], unchanged: 3 },
      { table: "b", inserts: [{ id: "x" }], updates: [], deletes: [], unchanged: 0 },
    ];
    const plan = planWrites(quiet);
    expect(plan.upserts.map((d) => d.table)).toEqual(["b"]);
    expect(plan.deletes).toEqual([]);
  });
});

describe("the company_id guard", () => {
  it("refuses a dataset whose table is company scoped", () => {
    // The worst thing this tool could do is put one tenant's rows in
    // another tenant's database. It fails closed.
    expect(() =>
      assertNotCompanyScoped(classroom, {
        classroom_lessons: ["id", "title", "company_id"],
      })
    ).toThrow(SyncRefused);
  });

  it("names the offending table in the error", () => {
    expect(() =>
      assertNotCompanyScoped(classroom, {
        classroom_trainings: ["id", "company_id"],
      })
    ).toThrow(/classroom_trainings/);
  });

  it("allows the real classroom shape", () => {
    expect(() =>
      assertNotCompanyScoped(classroom, {
        classroom_categories: ["id", "name", "slug", "sort_order"],
        classroom_lessons: ["id", "category_id", "title", "published"],
        classroom_trainings: ["id", "lesson_id", "title", "body_json"],
      })
    ).not.toThrow();
  });

  it("checks the real columns rather than the declared dataset", () => {
    // The dataset file is a claim; the schema is the fact. A
    // company_id added by a later migration must still be caught.
    expect(() =>
      assertNotCompanyScoped(classroom, {
        classroom_tags: ["id", "name", "company_id"],
      })
    ).toThrow(SyncRefused);
  });
});

describe("the storage guard", () => {
  const attachments: SyncTable = {
    table: "classroom_attachments",
    primaryKey: ["id"],
  };
  const trainings: SyncTable = {
    table: "classroom_trainings",
    primaryKey: ["id"],
  };

  it("finds a private storage path", () => {
    const hits = findStorageReferences(attachments, [
      { id: "a", storage_path: "classroom/abc.pdf" },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].column).toBe("storage_path");
  });

  it("finds a public storage URL embedded in a jsonb body", () => {
    // The dangerous one: this URL keeps working on the target while
    // serving the primary's storage, so nothing looks broken.
    const hits = findStorageReferences(trainings, [
      {
        id: "t",
        body_json: {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: "https://bgofvcaeqxptbbffmyfl.supabase.co/storage/v1/object/public/classroom-images/x.jpg",
              },
            },
          ],
        },
      },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].sample).toContain("/storage/");
  });

  it("passes content with no storage reference", () => {
    const hits = findStorageReferences(trainings, [
      { id: "t", body_json: { type: "doc", content: [{ type: "text" }] } },
      { id: "u", body_json: null },
    ]);
    expect(hits).toEqual([]);
    expect(() => assertNoStorageReferences(hits)).not.toThrow();
  });

  it("refuses the run and explains why", () => {
    const hits = findStorageReferences(attachments, [
      { id: "a", storage_path: "classroom/abc.pdf" },
    ]);
    expect(() => assertNoStorageReferences(hits)).toThrow(SyncRefused);
    expect(() => assertNoStorageReferences(hits)).toThrow(/per project/);
  });

  it("does not mistake an ordinary external URL for storage", () => {
    const hits = findStorageReferences(trainings, [
      { id: "t", body_json: { src: "https://www.youtube.com/watch?v=abc" } },
    ]);
    expect(hits).toEqual([]);
  });
});
