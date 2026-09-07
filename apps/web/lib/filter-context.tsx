"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type TreatmentStatus = "unheated" | "heated_thermal";

export const CARAT_MIN = 0;
export const CARAT_MAX = 16;

// Matches the bracket boundaries from the spec: <1ct, 1-2.99ct, 3-4.99ct,
// 5-9.99ct, 10ct+. These are NOT evenly spaced on a linear 0-16 scale (1, 3,
// 5, 10 bunch toward the low end) — the slider must snap to bracket INDEX,
// not to raw carat value, or the thumb's real position drifts away from
// where its label sits and drag-snapping feels arbitrary.
export const CARAT_BRACKET_STOPS = [0, 1, 3, 5, 10, 16] as const;

export function describeCaratRange(min: number, max: number): string {
  const atMax = max >= CARAT_MAX;
  if (min <= CARAT_MIN && atMax) return "All Weights";
  if (atMax) return `${min.toFixed(1)}ct+`;
  return `${min.toFixed(1)} – ${max.toFixed(1)}ct`;
}

export const PRICE_MIN = 0;
export const PRICE_MAX = 20_000;

// Sold prices are heavily right-skewed (p25 ~$3, median ~$12, p90 ~$86, p99
// ~$517) — a linear slider would waste 95% of its travel on the bottom 1% of
// the range. Brackets follow the real distribution instead of round numbers.
export const PRICE_BRACKET_STOPS = [0, 10, 25, 75, 250, 1000, PRICE_MAX] as const;

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function describePriceRange(min: number, max: number): string {
  const atMax = max >= PRICE_MAX;
  if (min <= PRICE_MIN && atMax) return "All Prices";
  if (atMax) return `${priceFormatter.format(min)}+`;
  return `${priceFormatter.format(min)} – ${priceFormatter.format(max)}`;
}

interface FilterState {
  stoneType: string; // specific stone_type value; "all" is no longer selectable
  origin: string; // "all" | specific origin name
  treatment: string; // "all" | specific treatment_status value
  search: string; // free-text over listing titles; "" = no search
  caratRange: [number, number];
  priceRange: [number, number];
  certifiedOnly: boolean;
}

interface FilterContextValue extends FilterState {
  setStoneType: (stoneType: string) => void;
  setOrigin: (origin: string) => void;
  setTreatment: (treatment: string) => void;
  setSearch: (search: string) => void;
  setCaratRange: (range: [number, number]) => void;
  setPriceRange: (range: [number, number]) => void;
  setCertifiedOnly: (value: boolean) => void;
  resetFilters: () => void;
}

const DEFAULT_ORIGIN = "all";
const DEFAULT_TREATMENT = "all";
const DEFAULT_SEARCH = "";
const DEFAULT_CARAT_RANGE: [number, number] = [CARAT_MIN, CARAT_MAX];
const DEFAULT_PRICE_RANGE: [number, number] = [PRICE_MIN, PRICE_MAX];
const DEFAULT_CERTIFIED_ONLY = false;

const FilterContext = createContext<FilterContextValue | null>(null);

interface FilterProviderProps {
  children: ReactNode;
  // Species is always constrained (there is no "All Stones" view), so the
  // page hands in its top-count stone type as the starting point.
  defaultStoneType?: string;
}

// ---- URL sync -------------------------------------------------------
// The whole point: a comp set should be a LINK, not a screenshot. Every
// filter lives in the query string, so a search can be pasted to a
// counterparty and reproduces exactly — against live data, not a stale JPEG.
// Only non-default values are written, to keep shared URLs short and legible.

function parseNumberPair(raw: string | null, fallback: [number, number]): [number, number] {
  if (!raw) return fallback;
  const [a, b] = raw.split("-").map(Number);
  if (Number.isNaN(a) || Number.isNaN(b)) return fallback;
  return [a, b];
}

function readFiltersFromUrl(defaultStoneType: string): FilterState {
  if (typeof window === "undefined") {
    return {
      stoneType: defaultStoneType,
      origin: DEFAULT_ORIGIN,
      treatment: DEFAULT_TREATMENT,
      search: DEFAULT_SEARCH,
      caratRange: DEFAULT_CARAT_RANGE,
      priceRange: DEFAULT_PRICE_RANGE,
      certifiedOnly: DEFAULT_CERTIFIED_ONLY,
    };
  }
  const q = new URLSearchParams(window.location.search);
  return {
    stoneType: q.get("type") ?? defaultStoneType,
    origin: q.get("origin") ?? DEFAULT_ORIGIN,
    treatment: q.get("treatment") ?? DEFAULT_TREATMENT,
    search: q.get("q") ?? DEFAULT_SEARCH,
    caratRange: parseNumberPair(q.get("ct"), DEFAULT_CARAT_RANGE),
    priceRange: parseNumberPair(q.get("price"), DEFAULT_PRICE_RANGE),
    certifiedOnly: q.get("certified") === "1",
  };
}

function writeFiltersToUrl(state: FilterState, defaultStoneType: string) {
  const q = new URLSearchParams();
  if (state.stoneType !== defaultStoneType) q.set("type", state.stoneType);
  if (state.origin !== DEFAULT_ORIGIN) q.set("origin", state.origin);
  if (state.treatment !== DEFAULT_TREATMENT) q.set("treatment", state.treatment);
  if (state.search.trim() !== "") q.set("q", state.search.trim());
  if (state.caratRange[0] !== CARAT_MIN || state.caratRange[1] !== CARAT_MAX) {
    q.set("ct", `${state.caratRange[0]}-${state.caratRange[1]}`);
  }
  if (state.priceRange[0] !== PRICE_MIN || state.priceRange[1] !== PRICE_MAX) {
    q.set("price", `${state.priceRange[0]}-${state.priceRange[1]}`);
  }
  if (state.certifiedOnly) q.set("certified", "1");

  const qs = q.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  // replaceState, not push: dragging a slider shouldn't bury the back button
  // under dozens of history entries.
  window.history.replaceState(null, "", url);
}

export function FilterProvider({ children, defaultStoneType = "all" }: FilterProviderProps) {
  // Initialised from the URL so a shared link lands on the right comp set.
  const [state, setState] = useState<FilterState>(() => readFiltersFromUrl(defaultStoneType));

  useEffect(() => {
    writeFiltersToUrl(state, defaultStoneType);
  }, [state, defaultStoneType]);

  const patch = useCallback(
    (next: Partial<FilterState>) => setState((prev) => ({ ...prev, ...next })),
    []
  );

  const value = useMemo<FilterContextValue>(
    () => ({
      ...state,
      setStoneType: (stoneType) => patch({ stoneType }),
      setOrigin: (origin) => patch({ origin }),
      setTreatment: (treatment) => patch({ treatment }),
      setSearch: (search) => patch({ search }),
      setCaratRange: (caratRange) => patch({ caratRange }),
      setPriceRange: (priceRange) => patch({ priceRange }),
      setCertifiedOnly: (certifiedOnly) => patch({ certifiedOnly }),
      // Deliberately leaves stoneType alone — "Reset" clears the filter
      // panel's own controls, not the species you're browsing.
      resetFilters: () =>
        patch({
          origin: DEFAULT_ORIGIN,
          treatment: DEFAULT_TREATMENT,
          search: DEFAULT_SEARCH,
          caratRange: DEFAULT_CARAT_RANGE,
          priceRange: DEFAULT_PRICE_RANGE,
          certifiedOnly: DEFAULT_CERTIFIED_ONLY,
        }),
    }),
    [state, patch]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within a FilterProvider");
  return ctx;
}
