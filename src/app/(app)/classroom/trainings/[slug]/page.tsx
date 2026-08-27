import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getTrainingBySlug } from "@/lib/classroom/service";

// Legacy per-section permalink. Kept as a permanent redirect so any
// pre-reshape links (Aimee suggestions, coaching notes, shared
// bookmarks) resolve to the new lesson-nested URL:
//   /classroom/lessons/<lessonSlug>/<sectionSlug>
// Nothing renders here — permanent redirect only.

type PageProps = { params: Promise<{ slug: string }> };

export default async function TrainingRedirect({ params }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const { slug } = await params;
  const training = await getTrainingBySlug(slug);
  if (!training) notFound();

  redirect(`/classroom/lessons/${training.lesson.slug}/${training.slug}`);
}
