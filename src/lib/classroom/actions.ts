"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { JSONContent } from "@tiptap/react";

// Sysadmin-only writes for classroom content. RLS enforces the role
// gate at the database level; requireRole here fails fast with a
// meaningful error before the round-trip.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ActionResult<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

// ---- Categories ----

export async function createCategoryAction(
  name: string
): Promise<ActionResult<{ id: string }>> {
  await requireRole(["system_admin"]);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Give the category a name." };
  const slug = slugify(trimmed);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("classroom_categories")
    .insert({ name: trimmed, slug })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that category — slug may already exist." };
  }
  revalidatePath("/admin/classroom");
  revalidatePath("/classroom", "layout");
  return { ok: true, id: data.id };
}

// Rename a category. Only the display name changes — the slug
// stays the same so any Ask-Aimee reference or shared link that
// already points at /classroom/... survives the rename. If a
// caller ever needs to change the slug too, add a separate action
// that spells out the invalidation cost.
export async function renameCategoryAction(
  id: string,
  name: string
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Category name can't be empty." };
  if (trimmed.length > 80) {
    return { ok: false, message: "Keep the category name under 80 characters." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("classroom_categories")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't rename that category." };

  revalidatePath("/admin/classroom");
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

// ---- Lessons ----

export type LessonInput = {
  title: string;
  slug?: string;
  category_id: string | null;
  description: string;
  published: boolean;
};

export async function createLessonAction(
  input: LessonInput
): Promise<ActionResult<{ id: string }>> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the lesson a title." };
  const slug = input.slug?.trim() || slugify(title);

  const supabase = await createSupabaseServerClient();

  // Next sort_order within category so new lessons land at the end.
  const { data: last } = await supabase
    .from("classroom_lessons")
    .select("sort_order")
    .eq("category_id", input.category_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const sort_order = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("classroom_lessons")
    .insert({
      title,
      slug,
      category_id: input.category_id,
      description: input.description.trim() || null,
      published: input.published,
      sort_order,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that lesson — slug may already exist." };
  }
  revalidatePath("/admin/classroom");
  revalidatePath("/classroom", "layout");
  return { ok: true, id: data.id };
}

export async function updateLessonAction(
  id: string,
  input: LessonInput
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the lesson a title." };
  const slug = input.slug?.trim() || slugify(title);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("classroom_lessons")
    .update({
      title,
      slug,
      category_id: input.category_id,
      description: input.description.trim() || null,
      published: input.published,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save the lesson." };
  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${id}/edit`);
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

export async function deleteLessonAction(id: string): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("classroom_lessons").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete that lesson." };
  revalidatePath("/admin/classroom");
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

export async function moveLessonAction(
  id: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("classroom_lessons")
    .select("id, sort_order, category_id")
    .eq("id", id)
    .maybeSingle<{ id: string; sort_order: number; category_id: string | null }>();
  if (!current) return { ok: false, message: "Lesson not found." };

  const swapQuery = supabase
    .from("classroom_lessons")
    .select("id, sort_order")
    .order("sort_order", { ascending: direction === "up" ? false : true })
    .limit(1);
  const filteredQuery =
    current.category_id === null
      ? swapQuery.is("category_id", null)
      : swapQuery.eq("category_id", current.category_id);
  const { data: neighbor } = await (direction === "up"
    ? filteredQuery.lt("sort_order", current.sort_order)
    : filteredQuery.gt("sort_order", current.sort_order)
  ).maybeSingle<{ id: string; sort_order: number }>();

  if (!neighbor) return { ok: true };

  await supabase
    .from("classroom_lessons")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id);
  await supabase
    .from("classroom_lessons")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);

  revalidatePath("/admin/classroom");
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

// ---- Sections (data table stays classroom_trainings) ----
// UI vocabulary switched from "Training" to "Section" per the
// 0145 reshape. Videos now live inline in body_json as a custom
// Tiptap videoEmbed node, so the input shape is title + slug +
// body + published — no video_url, no thumbnail resolve.

export type TrainingInput = {
  lesson_id: string;
  title: string;
  slug?: string;
  body_json: JSONContent | null;
  published: boolean;
};

export async function createTrainingAction(
  input: TrainingInput
): Promise<ActionResult<{ id: string }>> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the section a title." };
  const slug = input.slug?.trim() || slugify(title);

  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from("classroom_trainings")
    .select("sort_order")
    .eq("lesson_id", input.lesson_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const sort_order = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("classroom_trainings")
    .insert({
      lesson_id: input.lesson_id,
      title,
      slug,
      body_json: sanitizeBodyJson(input.body_json),
      published: input.published,
      sort_order,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that section — slug may already exist." };
  }
  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${input.lesson_id}/edit`);
  revalidatePath("/classroom", "layout");
  return { ok: true, id: data.id };
}

export async function updateTrainingAction(
  id: string,
  input: TrainingInput & { body_json_string?: string }
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the section a title." };
  const slug = input.slug?.trim() || slugify(title);

  // Prefer body_json_string (a plain JSON string of the doc) over
  // body_json (a structured object) — the client now sends both
  // and the string variant survives Next.js server-action wire
  // transfer byte-for-byte. Falls back to body_json when a caller
  // hasn't been updated to send the string variant.
  let bodyJson = input.body_json;
  if (typeof input.body_json_string === "string") {
    try {
      bodyJson = JSON.parse(input.body_json_string);
    } catch (e) {
      console.error("[updateTraining] body_json_string parse failed", e);
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("classroom_trainings")
    .update({
      title,
      slug,
      lesson_id: input.lesson_id,
      body_json: sanitizeBodyJson(bodyJson),
      published: input.published,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save the section." };

  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${input.lesson_id}/edit`);
  revalidatePath(`/admin/classroom/trainings/${id}/edit`);
  // Layout-wide revalidation so every nested consumer route
  // (/classroom/lessons/[slug], /classroom/lessons/[slug]/[sectionSlug])
  // rebuilds its cached HTML with the current Renderer output.
  // A plain revalidatePath("/classroom") only invalidates the
  // landing page — the lesson/section pages kept serving cached
  // HTML from earlier deploys, which is why a fresh Renderer case
  // (e.g. the new link mark → <a>) didn't appear on the reader
  // side until the next full deploy of that route.
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

export async function deleteTrainingAction(id: string): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("classroom_trainings")
    .select("lesson_id")
    .eq("id", id)
    .maybeSingle<{ lesson_id: string }>();
  const { error } = await supabase.from("classroom_trainings").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete that section." };
  revalidatePath("/admin/classroom");
  if (existing?.lesson_id) {
    revalidatePath(`/admin/classroom/lessons/${existing.lesson_id}/edit`);
  }
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

export async function moveTrainingAction(
  id: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("classroom_trainings")
    .select("id, sort_order, lesson_id")
    .eq("id", id)
    .maybeSingle<{ id: string; sort_order: number; lesson_id: string }>();
  if (!current) return { ok: false, message: "Section not found." };

  const query = supabase
    .from("classroom_trainings")
    .select("id, sort_order")
    .eq("lesson_id", current.lesson_id)
    .order("sort_order", { ascending: direction === "up" ? false : true })
    .limit(1);
  const { data: neighbor } = await (direction === "up"
    ? query.lt("sort_order", current.sort_order)
    : query.gt("sort_order", current.sort_order)
  ).maybeSingle<{ id: string; sort_order: number }>();

  if (!neighbor) return { ok: true };

  await supabase
    .from("classroom_trainings")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id);
  await supabase
    .from("classroom_trainings")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);

  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${current.lesson_id}/edit`);
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

// ---- Attachments ----

// Uploads land under classroom-attachments/<training_id>/<uuid>-<name>.
// Uses the admin client because storage RLS is the write gate; keeping
// the caller's client would still work under the storage policy but
// we bypass to avoid tripping over auth cookie edge cases.
export async function uploadAttachmentAction(
  trainingId: string,
  formData: FormData
): Promise<ActionResult<{ id: string; file_name: string }>> {
  await requireRole(["system_admin"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Pick a file first." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, message: "Attachments cap at 25 MB." };
  }

  const admin = createSupabaseAdminClient();
  const safeName = sanitizeFilename(file.name);
  const path = `${trainingId}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from("classroom-attachments")
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false, message: "Upload failed — try again." };
  }

  const { data: last } = await admin
    .from("classroom_attachments")
    .select("sort_order")
    .eq("training_id", trainingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const sort_order = (last?.sort_order ?? -1) + 1;

  const { data, error } = await admin
    .from("classroom_attachments")
    .insert({
      training_id: trainingId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      file_size: file.size,
      sort_order,
    })
    .select("id, file_name")
    .single<{ id: string; file_name: string }>();
  if (error || !data) {
    await admin.storage.from("classroom-attachments").remove([path]);
    return { ok: false, message: "Couldn't record the attachment." };
  }

  revalidatePath(`/admin/classroom/trainings/${trainingId}/edit`);
  revalidatePath(`/classroom/trainings`);
  return { ok: true, id: data.id, file_name: data.file_name };
}

export async function deleteAttachmentAction(
  id: string
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const admin = createSupabaseAdminClient();
  const { data: att } = await admin
    .from("classroom_attachments")
    .select("id, storage_path, training_id")
    .eq("id", id)
    .maybeSingle<{ id: string; storage_path: string; training_id: string }>();
  if (!att) return { ok: false, message: "Attachment not found." };

  await admin.storage.from("classroom-attachments").remove([att.storage_path]);
  const { error } = await admin.from("classroom_attachments").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't remove that attachment." };

  revalidatePath(`/admin/classroom/trainings/${att.training_id}/edit`);
  revalidatePath("/classroom", "layout");
  return { ok: true };
}

// ---- Inline images (in section body_json) ----

// Uploads land under classroom-images/<uuid>-<name> in a public bucket.
// Inline images live in body_json as <img src="..."> nodes; signed URLs
// would expire mid-session and break the render, so the bucket is
// public. Writes are still sysadmin-only (role check + storage RLS).
const IMAGE_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function uploadClassroomImageAction(
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  await requireRole(["system_admin"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Pick an image first." };
  }
  if (!IMAGE_MIME_ALLOWLIST.has(file.type)) {
    return {
      ok: false,
      message: "Images must be PNG, JPG, GIF, or WebP.",
    };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, message: "Images cap at 8 MB." };
  }

  const admin = createSupabaseAdminClient();
  const safeName = sanitizeFilename(file.name);
  const path = `${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from("classroom-images")
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false, message: "Upload failed — try again." };
  }
  const { data } = admin.storage.from("classroom-images").getPublicUrl(path);
  if (!data?.publicUrl) {
    await admin.storage.from("classroom-images").remove([path]);
    return { ok: false, message: "Couldn't resolve the image URL." };
  }
  return { ok: true, url: data.publicUrl };
}

// ---- Utilities ----

// Strip link marks that have no href before persisting to the DB.
// An earlier iteration of the classroom editor saved link marks
// with empty attrs (setLink applied but href wasn't stored),
// which rendered as plain text on the reader side because the
// JSON walker requires an href to emit <a>. Cleaning here means
// no future save can leave the same trap for a reader.
//
// Recursive walk — link marks can live on any text run at any
// depth in the doc tree. Nodes with content get walked; text
// runs get their marks filtered.
function sanitizeBodyJson(
  json: JSONContent | null | undefined
): JSONContent | null {
  if (!json) return null;
  // Force plain-object deserialization first. Next.js 15 + React 19
  // proxies server-action arguments as "temporary client references"
  // for lazily-passed shapes; dot-accessing nested properties like
  // mark.attrs.href on those proxies throws the "Cannot access href
  // on the server" runtime error. A JSON round-trip flattens the
  // input to real POJOs so our walker only touches plain values.
  let plain: JSONContent;
  try {
    plain = JSON.parse(JSON.stringify(json)) as JSONContent;
  } catch {
    // If the input can't be JSON-stringified at all, something
    // upstream is broken and there's nothing safe to sanitize;
    // return null so the caller writes a null body rather than a
    // corrupt one.
    return null;
  }
  return walkNode(plain);
}

function walkNode(node: JSONContent): JSONContent {
  const next: JSONContent = { ...node };
  if (Array.isArray(node.marks)) {
    next.marks = node.marks.filter((mark) => {
      if (mark.type !== "link") return true;
      const href = (mark.attrs as { href?: unknown } | undefined)?.href;
      return typeof href === "string" && href.trim().length > 0;
    });
  }
  if (Array.isArray(node.content)) {
    next.content = node.content.map(walkNode);
  }
  return next;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}
