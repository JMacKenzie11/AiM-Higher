// The "work with Aimee" link: /ask-aimee/handoff/<token>, the token a
// short random id (24 url-safe characters). Kept exact so sign-in can
// return to it and to nothing that only looks like it.
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
const HANDOFF_PATH = /^\/ask-aimee\/handoff\/[A-Za-z0-9_-]{24}$/;

export function isHandoffToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

export function isHandoffPath(path: string | null | undefined): path is string {
  return typeof path === "string" && HANDOFF_PATH.test(path);
}

export function handoffPathFor(token: string): string {
  return `/ask-aimee/handoff/${token}`;
}
