import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getLessonBySlug } from "@/lib/classroom/service";
import { LessonView } from "./LessonView";

// Lesson viewer landing on the first section. A section-scoped
// permalink lives at /classroom/lessons/[slug]/[sectionSlug] and
// reuses LessonView with a different active tab.

type PageProps = { params: Promise<{ slug: string }> };

export default async function LessonPage({ params }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const { slug } = await params;
  const lesson = await getLessonBySlug(slug);
  if (!lesson) notFound();

  const first = lesson.trainings[0] ?? null;
  return <LessonView lesson={lesson} activeSection={first} />;
}
