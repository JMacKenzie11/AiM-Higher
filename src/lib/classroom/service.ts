import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ClassroomAttachment,
  ClassroomCategory,
  ClassroomLesson,
  ClassroomTraining,
  LessonWithTrainings,
  TrainingWithContext,
} from "./types";

// RLS-scoped reads. Consumer pages see only published rows for
// companies with the 'classroom' feature; system_admins see
// everything (draft included).

export async function listCategories(): Promise<ClassroomCategory[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("classroom_categories")
    .select("*")
    .order("sort_order")
    .order("name");
  return (data ?? []) as ClassroomCategory[];
}

export async function listLessons(): Promise<ClassroomLesson[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("classroom_lessons")
    .select("*")
    .order("sort_order")
    .order("title");
  return (data ?? []) as ClassroomLesson[];
}

// Landing-page shape: every category with its lessons in order.
// Uncategorized lessons (category_id is null) surface at the end
// under a synthetic "Other" bucket.
export type CategoryWithLessons = ClassroomCategory & {
  lessons: ClassroomLesson[];
};

export async function listCategoriesWithLessons(): Promise<CategoryWithLessons[]> {
  const [categories, lessons] = await Promise.all([listCategories(), listLessons()]);
  const byCategory = new Map<string | null, ClassroomLesson[]>();
  for (const l of lessons) {
    const key = l.category_id ?? null;
    const list = byCategory.get(key) ?? [];
    list.push(l);
    byCategory.set(key, list);
  }
  const result: CategoryWithLessons[] = categories.map((c) => ({
    ...c,
    lessons: byCategory.get(c.id) ?? [],
  }));
  const uncategorized = byCategory.get(null) ?? [];
  if (uncategorized.length > 0) {
    result.push({
      id: "__uncategorized__",
      name: "Other",
      slug: "other",
      sort_order: 999999,
      created_at: "",
      updated_at: "",
      lessons: uncategorized,
    });
  }
  return result;
}

export async function getLessonBySlug(
  slug: string
): Promise<LessonWithTrainings | null> {
  const supabase = await createSupabaseServerClient();
  const { data: lesson } = await supabase
    .from("classroom_lessons")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<ClassroomLesson>();
  if (!lesson) return null;

  const [{ data: category }, { data: trainings }] = await Promise.all([
    lesson.category_id
      ? supabase
          .from("classroom_categories")
          .select("*")
          .eq("id", lesson.category_id)
          .maybeSingle<ClassroomCategory>()
      : Promise.resolve({ data: null }),
    supabase
      .from("classroom_trainings")
      .select("*")
      .eq("lesson_id", lesson.id)
      .order("sort_order")
      .order("title"),
  ]);

  return {
    ...lesson,
    category: (category ?? null) as ClassroomCategory | null,
    trainings: (trainings ?? []) as ClassroomTraining[],
  };
}

export async function getLessonById(id: string): Promise<
  (ClassroomLesson & { trainings: ClassroomTraining[] }) | null
> {
  const supabase = await createSupabaseServerClient();
  const { data: lesson } = await supabase
    .from("classroom_lessons")
    .select("*")
    .eq("id", id)
    .maybeSingle<ClassroomLesson>();
  if (!lesson) return null;
  const { data: trainings } = await supabase
    .from("classroom_trainings")
    .select("*")
    .eq("lesson_id", lesson.id)
    .order("sort_order");
  return {
    ...lesson,
    trainings: (trainings ?? []) as ClassroomTraining[],
  };
}

export async function getTrainingBySlug(
  slug: string
): Promise<TrainingWithContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data: training } = await supabase
    .from("classroom_trainings")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<ClassroomTraining>();
  if (!training) return null;

  const [{ data: lesson }, { data: attachments }] = await Promise.all([
    supabase
      .from("classroom_lessons")
      .select("*")
      .eq("id", training.lesson_id)
      .maybeSingle<ClassroomLesson>(),
    supabase
      .from("classroom_attachments")
      .select("*")
      .eq("training_id", training.id)
      .order("sort_order"),
  ]);

  if (!lesson) return null;

  let category: ClassroomCategory | null = null;
  if (lesson.category_id) {
    const { data } = await supabase
      .from("classroom_categories")
      .select("*")
      .eq("id", lesson.category_id)
      .maybeSingle<ClassroomCategory>();
    category = data ?? null;
  }

  return {
    ...training,
    lesson,
    category,
    attachments: (attachments ?? []) as ClassroomAttachment[],
  };
}

export async function getTrainingById(id: string): Promise<
  (ClassroomTraining & { attachments: ClassroomAttachment[] }) | null
> {
  const supabase = await createSupabaseServerClient();
  const { data: training } = await supabase
    .from("classroom_trainings")
    .select("*")
    .eq("id", id)
    .maybeSingle<ClassroomTraining>();
  if (!training) return null;
  const { data: attachments } = await supabase
    .from("classroom_attachments")
    .select("*")
    .eq("training_id", training.id)
    .order("sort_order");
  return {
    ...training,
    attachments: (attachments ?? []) as ClassroomAttachment[],
  };
}
