// Where the Google Docs sign-in sends the person back to (0318): a
// path on this site, never another host. "/x" passes; "//evil.com",
// "https://…" and "/\evil" do not, and fall back to Ask Aimee.
export function safeReturnPath(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.length > 500 || /[\r\n]/.test(v)) return "/ask-aimee";
  return v;
}
