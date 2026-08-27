import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getTrainingBySlug } from "@/lib/classroom/service";
import { signAttachmentUrls } from "@/lib/classroom/attachments";
import { TipTapRenderer } from "@/components/tiptap/Renderer";
import styles from "../../classroom.module.css";

type PageProps = { params: Promise<{ slug: string }> };

export default async function TrainingPage({ params }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const { slug } = await params;
  const training = await getTrainingBySlug(slug);
  if (!training) notFound();

  const attachments = await signAttachmentUrls(training.attachments);

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Training">
        <div className={styles.heroInner}>
          <Link
            href={`/classroom/lessons/${training.lesson.slug}`}
            className={styles.crumbLink}
          >
            ← {training.lesson.title}
          </Link>
          <p className={styles.eyebrow}>
            {training.category?.name ?? "Training"}
          </p>
          <h1 className={styles.h1}>{training.title}</h1>
          <span className={styles.rule} aria-hidden="true" />
        </div>
      </section>

      <div className={styles.content}>
        {training.body_json ? (
          <section className={styles.card} aria-labelledby="training-body">
            <h2 id="training-body" className={styles.categoryName}>
              About this training
            </h2>
            <TipTapRenderer json={training.body_json} />
          </section>
        ) : null}

        {attachments.length > 0 ? (
          <section className={styles.card} aria-labelledby="training-attachments">
            <h2 id="training-attachments" className={styles.categoryName}>
              Downloads
            </h2>
            <ul className={styles.attachmentsList}>
              {attachments.map((a) => (
                <li key={a.id}>
                  {a.download_url ? (
                    <a
                      href={a.download_url}
                      className={styles.attachmentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div>
                        <div className={styles.attachmentName}>{a.file_name}</div>
                        <div className={styles.attachmentMeta}>
                          {a.mime_type ?? "file"}
                          {a.file_size ? ` · ${formatBytes(a.file_size)}` : ""}
                        </div>
                      </div>
                      <span aria-hidden="true">↓</span>
                    </a>
                  ) : (
                    <div className={styles.attachmentLink}>
                      <div>
                        <div className={styles.attachmentName}>{a.file_name}</div>
                        <div className={styles.attachmentMeta}>
                          Download unavailable
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
