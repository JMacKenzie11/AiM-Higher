import "server-only";

import { google } from "googleapis";

// Save to Google Docs (0318) runs on its OWN Google app, not the
// transcript one (GOOGLE_OAUTH_*). That app asks for drive.readonly,
// which Google classes as restricted: an unverified app asking for it
// shows a warning and is capped at 100 people. This one asks only for
// drive.file, which reaches the files AiMS-HQ creates and nothing
// else in the person's Drive, and which Google lets any account
// grant without a review.
//
// Both variables unset: the button is not shown anywhere.

export const GOOGLE_DOCS_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

export function googleDocsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DOCS_CLIENT_ID && process.env.GOOGLE_DOCS_CLIENT_SECRET);
}

// The redirect is the request's own host (instances/origin.ts), so
// each instance's address is registered on the Google app.
export function googleDocsRedirectUri(origin: string): string {
  return `${origin}/api/oauth/google-docs/callback`;
}

export function googleDocsOAuthClient(origin: string) {
  const id = process.env.GOOGLE_DOCS_CLIENT_ID;
  const secret = process.env.GOOGLE_DOCS_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Save to Google Docs is not set up.");
  return new google.auth.OAuth2(id, secret, googleDocsRedirectUri(origin));
}
