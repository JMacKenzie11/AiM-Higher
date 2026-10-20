"use client";

import { createContext, useContext, useEffect } from "react";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";

// THE WORK DRAWER: one drawer for an issue or a commitment, on every
// page that lists them (Jason, 2026-10-16).
//
// Rows do not pass their data to the drawer when they open it. They
// REGISTER it, every render, and the drawer reads the open item from
// that registry. So after a save, when the page refreshes and the rows
// render with the new data, the open drawer shows it too, without
// fetching anything of its own. This file is the rows' half: the
// context, its types and the hooks. The drawer is WorkDrawerProvider.

export type Roster = Array<Pick<Profile, "id" | "full_name">>;

// What a commitment row knows about who is looking at it, which the
// drawer needs to offer the same edits the row does.
export type CommitmentContext = {
  roster: Roster;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  canResolve: boolean;
  canLink: boolean;
  canReassign: boolean;
  currentUserId: string;
  isAdmin: boolean;
};

export type IssueContext = {
  roster: Roster;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  // For the commitment drawer's Linked to picker.
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
  canEdit: boolean;
  // Whether this person may add a commitment on it (canOwnWorkIn).
  canAdd: boolean;
};

// What "Add a commitment" knows when it opens the drawer on a new
// commitment (the add-panel switch): the same choices the add row
// offered. `fixedPriorityId` pins the link on a priority's own page.
export type NewCommitmentContext = {
  roster: Roster;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  thisFriday: string;
  currentUserId: string;
  isAdmin: boolean;
  fixedPriorityId?: string | null;
};

export type WorkDrawerApi = {
  registerCommitment: (c: CommitmentWithMeta, ctx: CommitmentContext) => void;
  registerIssue: (issue: IssueWithCommitments, ctx: IssueContext) => void;
  hasIssue: (id: string) => boolean;
  // `from` is the element clicked: previous and next step through the
  // commitments listed around it, in the order they appear.
  openCommitment: (id: string, from: HTMLElement | null) => void;
  openIssue: (id: string) => void;
  openNewIssue: (ctx: IssueContext) => void;
  openNewCommitment: (ctx: NewCommitmentContext) => void;
  // Issues deleted with the undo chip still showing: hidden at once,
  // deleted when the chip goes.
  isIssueHidden: (id: string) => boolean;
  deleteIssueWithUndo: (id: string) => void;
  showUndo: (label: string, undo: () => void) => void;
};

export const WorkDrawerContext = createContext<WorkDrawerApi | null>(null);

export function useWorkDrawer(): WorkDrawerApi | null {
  return useContext(WorkDrawerContext);
}

export function useRegisterCommitment(c: CommitmentWithMeta, ctx: CommitmentContext) {
  const api = useWorkDrawer();
  useEffect(() => {
    api?.registerCommitment(c, ctx);
  });
}

export function useRegisterIssue(issue: IssueWithCommitments, ctx: IssueContext) {
  const api = useWorkDrawer();
  useEffect(() => {
    api?.registerIssue(issue, ctx);
  });
}
