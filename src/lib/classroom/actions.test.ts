import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/classroom/actions.ts. The interesting
// contracts are the sort_order tail-append pattern (new items land at
// the end of their scope: lessons per category, trainings per lesson,
// attachments per training), the video URL parse gate on training
// writes, and the storage-rollback on uploadAttachment (if the DB
// insert fails after the file already landed in Supabase Storage,
// the file MUST be removed so we don't leak orphan blobs).

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const categoriesInsert = vi.fn();
  const categoriesInsertSingle = vi.fn();

  const lessonsInsertPatch = vi.fn();
  const lessonsInsertSingle = vi.fn();
  const lessonsTailSort = vi.fn(); // .select("sort_order").eq().order().limit(1).maybeSingle()

  const trainingsInsertPatch = vi.fn();
  const trainingsInsertSingle = vi.fn();
  const trainingsTailSort = vi.fn();

  const attachmentsInsertPatch = vi.fn();
  const attachmentsInsertSingle = vi.fn();
  const attachmentsTailSort = vi.fn();
  const attachmentsSelectMaybeSingle = vi.fn();
  const attachmentsDeleteEq = vi.fn();

  const storageUpload = vi.fn();
  const storageRemove = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "classroom_categories") {
      return {
        insert: (patch: unknown) => {
          categoriesInsert(patch);
          return { select: () => ({ single: categoriesInsertSingle }) };
        },
      };
    }
    if (table === "classroom_lessons") {
      return {
        insert: (patch: unknown) => {
          lessonsInsertPatch(patch);
          return { select: () => ({ single: lessonsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: lessonsTailSort }) }),
          }),
        }),
      };
    }
    if (table === "classroom_trainings") {
      return {
        insert: (patch: unknown) => {
          trainingsInsertPatch(patch);
          return { select: () => ({ single: trainingsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: trainingsTailSort }) }),
          }),
        }),
      };
    }
    if (table === "classroom_attachments") {
      return {
        insert: (patch: unknown) => {
          attachmentsInsertPatch(patch);
          return { select: () => ({ single: attachmentsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ maybeSingle: attachmentsTailSort }) }),
            maybeSingle: attachmentsSelectMaybeSingle,
          }),
        }),
        delete: () => ({ eq: () => attachmentsDeleteEq() }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const admin = {
    from: fromBuilder,
    storage: {
      from: () => ({ upload: storageUpload, remove: storageRemove }),
    },
  };

  const requireRole = vi.fn();
  const revalidatePath = vi.fn();
  const parseAndResolve = vi.fn();

  return {
    categoriesInsert,
    categoriesInsertSingle,
    lessonsInsertPatch,
    lessonsInsertSingle,
    lessonsTailSort,
    trainingsInsertPatch,
    trainingsInsertSingle,
    trainingsTailSort,
    attachmentsInsertPatch,
    attachmentsInsertSingle,
    attachmentsTailSort,
    attachmentsSelectMaybeSingle,
    attachmentsDeleteEq,
    storageUpload,
    storageRemove,
    serverClient,
    admin,
    requireRole,
    revalidatePath,
    parseAndResolve,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("./video", () => ({
  parseAndResolve: mocks.parseAndResolve,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function primeHappyPath() {
  mocks.requireRole.mockResolvedValue({
    profile: { id: "root", role: "system_admin" },
  });
  mocks.categoriesInsertSingle.mockResolvedValue({
    data: { id: "cat_new" },
    error: null,
  });
  mocks.lessonsInsertSingle.mockResolvedValue({
    data: { id: "lesson_new" },
    error: null,
  });
  mocks.lessonsTailSort.mockResolvedValue({ data: { sort_order: 2 } });
  mocks.trainingsInsertSingle.mockResolvedValue({
    data: { id: "train_new" },
    error: null,
  });
  mocks.trainingsTailSort.mockResolvedValue({ data: { sort_order: 0 } });
  mocks.attachmentsInsertSingle.mockResolvedValue({
    data: { id: "att_new", file_name: "notes.pdf" },
    error: null,
  });
  mocks.attachmentsTailSort.mockResolvedValue({ data: { sort_order: 1 } });
  mocks.attachmentsSelectMaybeSingle.mockResolvedValue({
    data: { id: "att_1", storage_path: "train_1/abc-notes.pdf", training_id: "train_1" },
    error: null,
  });
  mocks.attachmentsDeleteEq.mockResolvedValue({ error: null });
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.storageRemove.mockResolvedValue({ error: null });
  mocks.parseAndResolve.mockResolvedValue({
    ok: true,
    provider: "youtube",
    id: "abc123",
    url: "https://youtube.com/watch?v=abc123",
    thumbnail: "https://img.youtube.com/vi/abc123/0.jpg",
  });
}

// ==============================================================
// createCategoryAction / createLessonAction
// ==============================================================
describe("createCategoryAction + createLessonAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("createCategory rejects an empty name", async () => {
    const { createCategoryAction } = await import("./actions");

    const res = await createCategoryAction("   ");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/name/i);
    expect(mocks.categoriesInsert).not.toHaveBeenCalled();
  });

  it("createCategory generates a slug from the name (lowercase, hyphens, ascii-normalized)", async () => {
    const { createCategoryAction } = await import("./actions");

    await createCategoryAction("Café & Tea Time!");

    const patch = mocks.categoriesInsert.mock.calls[0][0] as { slug: string };
    expect(patch.slug).toBe("cafe-tea-time");
  });

  it("createLesson tail-appends sort_order (last=2 → new=3)", async () => {
    const { createLessonAction } = await import("./actions");

    await createLessonAction({
      title: "Weekly review",
      category_id: "cat_1",
      description: "",
      published: false,
    });

    const patch = mocks.lessonsInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(3);
  });

  it("createLesson uses sort_order=0 when the category has no lessons yet", async () => {
    mocks.lessonsTailSort.mockResolvedValueOnce({ data: null });
    const { createLessonAction } = await import("./actions");

    await createLessonAction({
      title: "First lesson",
      category_id: "cat_1",
      description: "",
      published: false,
    });

    const patch = mocks.lessonsInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(0);
  });
});

// ==============================================================
// createTrainingAction
// ==============================================================
describe("createTrainingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an unparseable video URL before touching the DB", async () => {
    // parseAndResolve is the URL-shape gate. Landing a training row
    // with a bad video URL would render as a broken embed on the
    // training page forever until an admin edits it.
    mocks.parseAndResolve.mockResolvedValueOnce({
      ok: false,
      message: "unrecognized URL",
    });
    const { createTrainingAction } = await import("./actions");

    const res = await createTrainingAction({
      lesson_id: "lesson_1",
      title: "Bad video",
      video_url: "not a youtube link",
      body_json: null,
      published: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/YouTube or Vimeo/);
    expect(mocks.trainingsInsertPatch).not.toHaveBeenCalled();
  });

  it("stores the resolved provider/id/url/thumbnail from parseAndResolve, not the raw input", async () => {
    // Contract: the parser normalizes shortlinks and strips query
    // params. Storing the raw URL would break embeds for youtu.be,
    // Vimeo private links, etc.
    const { createTrainingAction } = await import("./actions");

    await createTrainingAction({
      lesson_id: "lesson_1",
      title: "Weekly kickoff",
      video_url: "https://youtu.be/abc123?feature=share",
      body_json: null,
      published: false,
    });

    expect(mocks.trainingsInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        video_provider: "youtube",
        video_id: "abc123",
        video_url: "https://youtube.com/watch?v=abc123",
      })
    );
  });
});

// ==============================================================
// uploadAttachmentAction — the storage-rollback contract
// ==============================================================
describe("uploadAttachmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  function fileForm(file: File | null): FormData {
    const fd = new FormData();
    if (file) fd.set("file", file);
    return fd;
  }

  it("rejects a request with no file / empty file", async () => {
    const { uploadAttachmentAction } = await import("./actions");

    const res = await uploadAttachmentAction("train_1", fileForm(null));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Pick a file/);
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("rejects files larger than 25 MB", async () => {
    // Faked size beats making an actual 25MB Blob in a unit test.
    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 26 * 1024 * 1024 });
    const { uploadAttachmentAction } = await import("./actions");

    const res = await uploadAttachmentAction("train_1", fileForm(bigFile));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/25 MB/);
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("rolls back the uploaded blob if the DB insert fails", async () => {
    // Orphan-blob guard: without this, a failed DB insert leaves a
    // real file living in Supabase Storage that no row references.
    // Storage bytes cost money and are invisible to the admin UI.
    mocks.attachmentsInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "unique violation" },
    });
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    const { uploadAttachmentAction } = await import("./actions");

    const res = await uploadAttachmentAction("train_1", fileForm(file));

    expect(res.ok).toBe(false);
    expect(mocks.storageRemove).toHaveBeenCalledTimes(1);
    // The path we tried to remove should match the one we uploaded to.
    const removedPaths = mocks.storageRemove.mock.calls[0][0] as string[];
    expect(removedPaths[0]).toContain("train_1/");
  });

  it("uploads under train_id/<uuid>-<sanitized_name> and stores the file name as sent", async () => {
    const file = new File(["hello"], "My Notes 2026.pdf", {
      type: "application/pdf",
    });
    const { uploadAttachmentAction } = await import("./actions");

    await uploadAttachmentAction("train_1", fileForm(file));

    const [uploadedPath] = mocks.storageUpload.mock.calls[0] as [string];
    expect(uploadedPath).toMatch(/^train_1\/[a-f0-9-]+-my-notes-2026\.pdf$/);
    // The DB row should keep the ORIGINAL filename (with spaces + case)
    // so the download button shows a human-friendly name.
    expect(mocks.attachmentsInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ file_name: "My Notes 2026.pdf" })
    );
  });
});

// ==============================================================
// deleteAttachmentAction
// ==============================================================
describe("deleteAttachmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("removes both the storage blob AND the DB row (not just the DB row)", async () => {
    // If either one is skipped, we either leak bytes or leave a broken
    // row pointing at nothing.
    const { deleteAttachmentAction } = await import("./actions");

    const res = await deleteAttachmentAction("att_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.storageRemove).toHaveBeenCalledWith(["train_1/abc-notes.pdf"]);
    expect(mocks.attachmentsDeleteEq).toHaveBeenCalledTimes(1);
  });

  it("errors gracefully when the attachment doesn't exist", async () => {
    mocks.attachmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { deleteAttachmentAction } = await import("./actions");

    const res = await deleteAttachmentAction("att_missing");

    expect(res).toEqual({ ok: false, message: "Attachment not found." });
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(mocks.attachmentsDeleteEq).not.toHaveBeenCalled();
  });
});
