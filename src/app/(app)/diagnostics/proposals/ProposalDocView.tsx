import type { ReactNode } from "react";
import type { ProposalDoc, ProposalSection } from "@/lib/diagnostics/proposals";
import styles from "./proposals.module.css";

// A proposal as a page: the sections in order, each document drawn from
// its TipTap JSON. The owner reads this on the portal before signing,
// and it matches the PDF (pdf/ProposalPdf.tsx). Keep the nodes in step
// with cleanDoc in lib/diagnostics/proposals.ts.

function inline(nodes: ProposalDoc[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    const k = `${key}.${i}`;
    if (n.type === "hardBreak") return <br key={k} />;
    if (n.type !== "text") return null;
    let out: ReactNode = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") out = <strong>{out}</strong>;
      else if (m.type === "italic") out = <em>{out}</em>;
      else if (m.type === "underline") out = <u>{out}</u>;
      else if (m.type === "strike") out = <s>{out}</s>;
      else if (m.type === "link" && typeof m.attrs?.href === "string")
        out = (
          <a href={m.attrs.href} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        );
    }
    return <span key={k}>{out}</span>;
  });
}

function blocks(nodes: ProposalDoc[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    const k = `${key}.${i}`;
    if (n.type === "paragraph") return <p key={k}>{inline(n.content, k)}</p>;
    if (n.type === "bulletList") return <ul key={k}>{(n.content ?? []).map((li, j) => <li key={`${k}.${j}`}>{blocks(li.content, `${k}.${j}`)}</li>)}</ul>;
    if (n.type === "orderedList")
      return (
        <ol key={k} start={typeof n.attrs?.start === "number" ? n.attrs.start : undefined}>
          {(n.content ?? []).map((li, j) => (
            <li key={`${k}.${j}`}>{blocks(li.content, `${k}.${j}`)}</li>
          ))}
        </ol>
      );
    return null;
  });
}

export function ProposalDocView({ title, subtitle, sections }: { title: string; subtitle: string; sections: ProposalSection[] }) {
  return (
    <article className={styles.doc}>
      <header className={styles.docTop}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/aims-logo.png" alt="AiMS Institute" className={styles.docLogo} />
        <div>
          <h2 className={styles.docTitle}>{title}</h2>
          <p className={styles.docSub}>{subtitle}</p>
        </div>
      </header>
      {sections.map((s) => (
        <section key={s.key} className={styles.docSection} aria-label={s.title}>
          <h3 className={styles.docHeading}>{s.title}</h3>
          {blocks(s.doc.content, s.key)}
        </section>
      ))}
    </article>
  );
}
