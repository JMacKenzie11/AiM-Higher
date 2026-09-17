"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ExternalMeasureInfo, ExternalPanel } from "@/lib/external-measures/service";

// External-measure state, delivered to the one row that wants it.
//
// A CONTEXT RATHER THAN PROPS, and the reason is structural. /measures
// renders page -> MeasuresManager -> FunctionSection -> OutcomeSection
// -> ManagedMeasureRow, and only the last of those has any use for a
// pulled tag. Threading two props through three components that do not
// read them is how an optional feature becomes part of every
// component's signature, and the next person removing the feature has
// four files to edit instead of one.
//
// The default is the OFF state, not an error. A page that never wraps
// this renders exactly as it did before 0212, which is what every
// company but the flagged one gets.

export type ExternalMeasuresValue = {
  enabled: boolean;
  // Whether this caller may press "Pull now". The company's admins,
  // which is the same set the action and the database will check
  // again — this only decides whether a button is drawn.
  canPull: boolean;
  // Mapping administration is system_admin only in phase 1.
  canAdminister: boolean;
  timezone: string;
  weeks: string[];
  byMeasureId: Record<string, ExternalMeasureInfo>;
};

const OFF: ExternalMeasuresValue = {
  enabled: false,
  canPull: false,
  canAdminister: false,
  timezone: "UTC",
  weeks: [],
  byMeasureId: {},
};

const Ctx = createContext<ExternalMeasuresValue>(OFF);

export function ExternalMeasuresProvider({
  panel,
  canPull,
  canAdminister,
  children,
}: {
  // null when the feature is off for this company. Passing null
  // rather than omitting the provider keeps the page's JSX the same
  // shape in both states.
  panel: ExternalPanel | null;
  canPull: boolean;
  canAdminister: boolean;
  children: ReactNode;
}) {
  const value: ExternalMeasuresValue = panel
    ? {
        enabled: true,
        canPull,
        canAdminister,
        timezone: panel.timezone,
        weeks: panel.weeks,
        byMeasureId: panel.byMeasureId,
      }
    : OFF;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExternalMeasures(): ExternalMeasuresValue {
  return useContext(Ctx);
}

export function useExternalMeasure(measureId: string): ExternalMeasureInfo | null {
  const { enabled, byMeasureId } = useContext(Ctx);
  if (!enabled) return null;
  return byMeasureId[measureId] ?? null;
}
