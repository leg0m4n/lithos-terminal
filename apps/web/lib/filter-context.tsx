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
  stoneType: string; // "all" | specific stone_type value
  origin: string; // "all" | specific origin name
  color: string; // "all" | specific color_category value
  caratRange: [number, number];
  priceRange: [number, number];
  certifiedOnly: boolean;
}

interface FilterContextValue extends FilterState {
  setStoneType: (stoneType: string) => void;
  setOrigin: (origin: string) => void;
  setColor: (color: string) => void;
  setCaratRange: (range: [number, number]) => void;
  setPriceRange: (range: [number, number]) => void;
  setCertifiedOnly: (value: boolean) => void;
  resetFilters: () => void;
}

const DEFAULT_ORIGIN = "all";
const DEFAULT_COLOR = "all";
const DEFAULT_CARAT_RANGE: [number, number] = [CARAT_MIN, CARAT_MAX];
const DEFAULT_PRICE_RANGE: [number, number] = [PRICE_MIN, PRICE_MAX];
const DEFAULT_CERTIFIED_ONLY = false;

const FilterContext = createContext<FilterContextValue | null>(null);

interface FilterProviderProps {
  children: ReactNode;
  // The chart mixes carat/price across totally different species if left on
  // "all", so the page hands in its top-count stone type as the real
  // default; "all" stays reachable as an explicit choice in the nav.
  defaultStoneType?: string;
}

export function FilterProvider({ children, defaultStoneType = "all" }: FilterProviderProps) {
  const [stoneType, setStoneType] = useState(defaultStoneType);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [caratRange, setCaratRange] = useState<[number, number]>(DEFAULT_CARAT_RANGE);
  const [priceRange, setPriceRange] = useState<[number, number]>(DEFAULT_PRICE_RANGE);
  const [certifiedOnly, setCertifiedOnly] = useState(DEFAULT_CERTIFIED_ONLY);

  const resetFilters = () => {
    // Deliberately leaves stoneType alone — "Reset" clears the filter
    // panel's own controls, not the left-nav category you're browsing.
    setOrigin(DEFAULT_ORIGIN);
    setColor(DEFAULT_COLOR);
    setCaratRange(DEFAULT_CARAT_RANGE);
    setPriceRange(DEFAULT_PRICE_RANGE);
    setCertifiedOnly(DEFAULT_CERTIFIED_ONLY);
  };

  const value = useMemo<FilterContextValue>(
    () => ({
      stoneType,
      origin,
      color,
      caratRange,
      priceRange,
      certifiedOnly,
      setStoneType,
      setOrigin,
      setColor,
      setCaratRange,
      setPriceRange,
      setCertifiedOnly,
      resetFilters,
    }),
    [stoneType, origin, color, caratRange, priceRange, certifiedOnly]
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
