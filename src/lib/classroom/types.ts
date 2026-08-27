// Domain types for the classroom module. Row shapes mirror the
// migration 0120 schema. See prompts in server actions for validation
// rules.

import type { JSONContent } from "@tiptap/react";

export type ClassroomCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ClassroomTag = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type ClassroomLesson = {
  id: string;
  category_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

// Kept as a shared union — the Tiptap videoEmbed node uses the
// same values on its `provider` attr, so the URL parser + embed
// helpers share one type.
export type ClassroomVideoProvider = "youtube" | "vimeo";

// A "Section" of a Lesson in the UI (URL, labels). The DB table
// stays classroom_trainings so downstream (attachments FK, action
// paths, tests) doesn't churn. Migration 0145 dropped
// video_provider / video_id / video_url / thumbnail_url — videos
// now live inline in body_json as a custom Tiptap node.
export type ClassroomTraining = {
  id: string;
  lesson_id: string;
  title: string;
  slug: string;
  body_json: JSONContent | null;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type ClassroomAttachment = {
  id: string;
  training_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  sort_order: number;
  created_at: string;
};

// Composed shape used by consumer pages so a single query round-trip
// hydrates both lesson metadata and its published trainings.
export type LessonWithTrainings = ClassroomLesson & {
  category: ClassroomCategory | null;
  trainings: ClassroomTraining[];
};

// Composed shape used by the training viewer.
export type TrainingWithContext = ClassroomTraining & {
  lesson: ClassroomLesson;
  category: ClassroomCategory | null;
  attachments: ClassroomAttachment[];
};
