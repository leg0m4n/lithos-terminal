"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type TreatmentStatus = "unheated" | "heated_thermal";

export const CARAT_MIN = 0;
export const CARAT_MAX = 16;

// Matches the bracket boundaries from the spec: <1ct, 1-2.99ct, 3-4.99ct,
// 5-9.99ct, 10ct+. The range slider snaps its thumbs to these stops.
export const CARAT_BRACKET_STOPS = [0, 1, 3, 5, 10, 16] as const;

export function snapToBracket(value: number): number {
  return CARAT_BRACKET_STOPS.reduce((closest, stop) =>
    Math.abs(stop - value) < Math.abs(closest - value) ? stop : closest
  );
}

export function describeCaratRange(min: number, max: number): string {
  const atMax = max >= CARAT_MAX;
  if (min <= CARAT_MIN && atMax) return "All Weights";
  if (atMax) return `${min.toFixed(1)}ct+`;
  return `${min.toFixed(1)} – ${max.toFixed(1)}ct`;
}

interface FilterState {
  treatmentStatuses: Set<TreatmentStatus>;
  origin: string; // "all" | specific origin name
  caratRange: [number, number];
}

interface FilterContextValue extends FilterState {
  toggleTreatmentStatus: (status: TreatmentStatus) => void;
  setOrigin: (origin: string) => void;
  setCaratRange: (range: [number, number]) => void;
  resetFilters: () => void;
}

const DEFAULT_TREATMENTS: TreatmentStatus[] = ["unheated", "heated_thermal"];
const DEFAULT_ORIGIN = "all";
const DEFAULT_CARAT_RANGE: [number, number] = [CARAT_MIN, CARAT_MAX];

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [treatmentStatuses, setTreatmentStatuses] = useState<Set<TreatmentStatus>>(
    () => new Set(DEFAULT_TREATMENTS)
  );
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [caratRange, setCaratRange] = useState<[number, number]>(DEFAULT_CARAT_RANGE);

  const toggleTreatmentStatus = (status: TreatmentStatus) => {
    setTreatmentStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const resetFilters = () => {
    setTreatmentStatuses(new Set(DEFAULT_TREATMENTS));
    setOrigin(DEFAULT_ORIGIN);
    setCaratRange(DEFAULT_CARAT_RANGE);
  };

  const value = useMemo<FilterContextValue>(
    () => ({
      treatmentStatuses,
      origin,
      caratRange,
      toggleTreatmentStatus,
      setOrigin,
      setCaratRange,
      resetFilters,
    }),
    [treatmentStatuses, origin, caratRange]
  );

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within a FilterProvider");
  return ctx;
}
