"use client";

import dynamic from "next/dynamic";
import styles from "./notes.module.css";

// THE NOTES EDITOR, FETCHED WHEN A DRAWER FIRST SHOWS IT.
//
// The work drawer is mounted in the (app) layout, so whatever it
// imports is downloaded on every page. The editor is TipTap and
// ProseMirror, about 127 kB compressed, and most page loads never open
// a drawer. Imported this way it is its own file, fetched the first
// time an editor is drawn and kept by the browser after that.
//
// Until it arrives the drawer shows the same empty box the editor
// itself shows while TipTap starts (notes.module.css .loading), so
// nothing moves when it lands.
export const NotesEditorLazy = dynamic(
  () => import("./NotesEditor").then((m) => m.NotesEditor),
  {
    ssr: false,
    loading: () => <div className={styles.loading} aria-hidden />,
  }
);
