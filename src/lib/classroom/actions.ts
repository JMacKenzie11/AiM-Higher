"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseAndResolve } from "./video";
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
  revalidatePath("/classroom");
  return { ok: true, id: data.id };
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
  revalidatePath("/classroom");
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
  revalidatePath("/classroom");
  return { ok: true };
}

export async function deleteLessonAction(id: string): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("classroom_lessons").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete that lesson." };
  revalidatePath("/admin/classroom");
  revalidatePath("/classroom");
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
  revalidatePath("/classroom");
  return { ok: true };
}

// ---- Trainings ----

export type TrainingInput = {
  lesson_id: string;
  title: string;
  slug?: string;
  video_url: string;
  body_json: JSONContent | null;
  published: boolean;
};

export async function createTrainingAction(
  input: TrainingInput
): Promise<ActionResult<{ id: string }>> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the training a title." };
  const parsed = await parseAndResolve(input.video_url);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "That doesn't look like a YouTube or Vimeo URL I can parse.",
    };
  }
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
      video_provider: parsed.provider,
      video_id: parsed.id,
      video_url: parsed.url,
      thumbnail_url: parsed.thumbnail,
      body_json: input.body_json,
      published: input.published,
      sort_order,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that training — slug may already exist." };
  }
  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${input.lesson_id}/edit`);
  revalidatePath("/classroom");
  return { ok: true, id: data.id };
}

export async function updateTrainingAction(
  id: string,
  input: TrainingInput
): Promise<ActionResult> {
  await requireRole(["system_admin"]);
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the training a title." };
  const parsed = await parseAndResolve(input.video_url);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "That doesn't look like a YouTube or Vimeo URL I can parse.",
    };
  }
  const slug = input.slug?.trim() || slugify(title);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("classroom_trainings")
    .update({
      title,
      slug,
      lesson_id: input.lesson_id,
      video_provider: parsed.provider,
      video_id: parsed.id,
      video_url: parsed.url,
      thumbnail_url: parsed.thumbnail,
      body_json: input.body_json,
      published: input.published,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save the training." };

  revalidatePath("/admin/classroom");
  revalidatePath(`/admin/classroom/lessons/${input.lesson_id}/edit`);
  revalidatePath(`/admin/classroom/trainings/${id}/edit`);
  revalidatePath("/classroom");
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
  if (error) return { ok: false, message: "Couldn't delete that training." };
  revalidatePath("/admin/classroom");
  if (existing?.lesson_id) {
    revalidatePath(`/admin/classroom/lessons/${existing.lesson_id}/edit`);
  }
  revalidatePath("/classroom");
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
  if (!current) return { ok: false, message: "Training not found." };

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
  revalidatePath("/classroom");
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
  revalidatePath("/classroom");
  return { ok: true };
}

// ---- Utilities ----

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
