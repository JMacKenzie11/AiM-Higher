import { isHandoffPath } from "@/lib/aimee/handoff-path";
// The one place sign-in may send a person back to, other than home.
//
// An outside assistant's sign-in lands on /oauth/consent; a person not
// yet signed in is sent to /sign-in first and must come back to the
// same request. The return address is checked against this exact shape
// so the sign-in form cannot be used to send anyone anywhere else.

const CONSENT_PATH = /^\/oauth\/consent\?authorization_id=[A-Za-z0-9_-]{8,200}$/;

export function consentPathFor(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${authorizationId}`;
}

// Where sign-in may send someone back to: the consent page, or a "work
// with Aimee" link (0281), each in its exact form and nothing else.
export function isConsentReturnPath(next: string | null | undefined): next is string {
  return typeof next === "string" && (CONSENT_PATH.test(next) || isHandoffPath(next));
}

export function isAuthorizationId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(id);
}
