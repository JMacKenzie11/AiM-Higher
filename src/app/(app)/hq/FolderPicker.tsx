"use client";

import { useState } from "react";
import { coachPickerTokenAction } from "@/lib/coaching-calls/actions";
import ui from "@/components/ui/ui.module.css";
import cc from "./coaching-calls.module.css";

// GOOGLE'S FOLDER PICKER on Coach HQ (Jason, 2026-11-17): the coach
// chooses the folder their calls are saved in from Google's own window,
// with its search box and Drive's tabs, instead of copying a link. Only
// folders can be picked. What it hands back is the folder's id, which
// goes through connectCoachFolderAction exactly as a pasted link does.
//
// Needs NEXT_PUBLIC_GOOGLE_PICKER_API_KEY (a key restricted to these
// websites and to the Picker API) and NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER.
// Without them the button isn't shown and pasting a link is the way.

const API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "").trim();
const PROJECT_NUMBER = (process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? "").trim();
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const folderPickerAvailable = API_KEY !== "" && PROJECT_NUMBER !== "";

// The parts of Google's picker library used here.
type PickerDoc = { id: string; name?: string };
type PickerResult = { action: string; docs?: PickerDoc[] };
type DocsView = {
  setIncludeFolders(v: boolean): DocsView;
  setSelectFolderEnabled(v: boolean): DocsView;
  setMimeTypes(m: string): DocsView;
  setEnableDrives(v: boolean): DocsView;
};
type PickerBuilder = {
  setTitle(t: string): PickerBuilder;
  addView(v: DocsView): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setOrigin(o: string): PickerBuilder;
  setCallback(cb: (r: PickerResult) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
};
type GooglePicker = {
  DocsView: new (viewId: string) => DocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { FOLDERS: string };
  Action: { PICKED: string; CANCEL: string };
};
type PickerWindow = Window & {
  gapi?: { load(name: string, cb: () => void): void };
  google?: { picker?: GooglePicker };
};

let loading: Promise<GooglePicker> | null = null;

function loadPicker(): Promise<GooglePicker> {
  if (loading) return loading;
  loading = new Promise<GooglePicker>((resolve, reject) => {
    const w = window as PickerWindow;
    const ready = () => w.gapi!.load("picker", () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error("no picker"))));
    if (w.gapi) return ready();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("script"));
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

export function FolderPickerButton({
  disabled,
  onPicked,
}: {
  disabled?: boolean;
  onPicked: (folderId: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setOpening(true);
    setError(null);
    try {
      const [picker, tokenResult] = await Promise.all([loadPicker(), coachPickerTokenAction()]);
      if (!tokenResult.ok) {
        setError(tokenResult.message);
        return;
      }
      const folders = (shared: boolean) => {
        const v = new picker.DocsView(picker.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes(FOLDER_MIME);
        return shared ? v.setEnableDrives(true) : v;
      };
      new picker.PickerBuilder()
        .setTitle("Choose the folder your calls are saved in")
        .addView(folders(false))
        .addView(folders(true))
        .setOAuthToken(tokenResult.token)
        .setDeveloperKey(API_KEY)
        .setAppId(PROJECT_NUMBER)
        .setOrigin(window.location.origin)
        .setCallback((r) => {
          if (r.action === picker.Action.PICKED && r.docs?.[0]?.id) onPicked(r.docs[0].id);
        })
        .build()
        .setVisible(true);
    } catch {
      setError("Google's folder picker didn't open. Try again, or paste a link instead.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <button type="button" className={`${ui.btn} ${ui.btnPrimary}`} disabled={disabled || opening} onClick={open}>
        {opening ? "Opening Google Drive..." : "Choose folder in Google Drive"}
      </button>
      {error ? (
        <p role="alert" className={cc.error}>
          {error}
        </p>
      ) : null}
    </>
  );
}
