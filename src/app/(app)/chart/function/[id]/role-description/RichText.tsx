// Renders text with any occurrence of the caller's `bold` strings
// wrapped in <strong>. Used on the RD view page + version viewer
// to bold the company's core values wherever the model mentions
// them, so reader eyes land on the values a coach cares about.
//
// - Longer bold strings match first (so "Own the Job" isn't
//   swallowed by a shorter "Own"), regex-safe on user-entered
//   values.
// - Case-insensitive match; preserves the original casing from
//   the source text so "own the job" stays lowercase.
// - Server component — no interactivity — so it can be reused on
//   both the live view and the frozen version routes.

import React from "react";

export function RichText({
  text,
  bold,
}: {
  text: string;
  bold: readonly string[];
}) {
  const cleaned = bold
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // longer first so multi-word values win over prefixes
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return <>{text}</>;

  const escaped = cleaned.map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part
      )}
    </>
  );
}

// Convenience wrapper that splits paragraphs on blank lines and
// renders each as its own <p>, with core values bolded throughout.
// Callers pass the paragraph className so this component stays
// styling-agnostic.
export function RichParagraphs({
  text,
  bold,
  className,
}: {
  text: string;
  bold: readonly string[];
  className?: string;
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={className}>
          <RichText text={p} bold={bold} />
        </p>
      ))}
    </>
  );
}
