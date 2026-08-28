import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getLessonBySlug } from "@/lib/classroom/service";
import { LessonView } from "../LessonView";

// Section-scoped Lesson permalink. Reuses LessonView so a shared
// link like /classroom/lessons/foo/what-is-this renders the same
// left-rail treatment as the landing page, just with a specific
// tab pre-activated.

type PageProps = {
  params: Promise<{ slug: string; sectionSlug: string }>;
  searchParams: Promise<{ debug?: string }>;
};

export default async function LessonSectionPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const { slug, sectionSlug } = await params;
  const search = await searchParams;
  const lesson = await getLessonBySlug(slug);
  if (!lesson) notFound();

  const active = lesson.trainings.find((t) => t.slug === sectionSlug) ?? null;
  if (!active) notFound();

  return (
    <LessonView
      lesson={lesson}
      activeSection={active}
      debug={search.debug === "json"}
    />
  );
}
