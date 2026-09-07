"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CARAT_MAX, CARAT_MIN, useFilters } from "@/lib/filter-context";
import {
  getOriginOptionsForType,
  getTreatmentOptionsForType,
  type StoneTypeOption,
} from "@/lib/market-data";

const SEARCH_DEBOUNCE_MS = 300;

// Appraisers don't think in ranges, they think "I have a 2.3ct stone". So the
// input is a target weight plus a tolerance, and we show the band it resolves
// to rather than hiding it.
const TOLERANCES = [
  { value: "10", label: "±10%" },
  { value: "15", label: "±15%" },
  { value: "25", label: "±25%" },
  { value: "50", label: "±50%" },
] as const;

const DEFAULT_TOLERANCE = "15";

function useScopedOptions(
  stoneType: string,
  value: string,
  setValue: (v: string) => void,
  fetcher: (stoneType: string) => Promise<string[]>
): string[] {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetcher(stoneType)
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        if (value !== "all" && !opts.includes(value)) setValue("all");
      })
      .catch(() => {
        /* transient — keep the last good list */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-scope on species change
  }, [stoneType, fetcher]);
  return options;
}

interface CompsCriteriaProps {
  stoneTypeOptions: StoneTypeOption[];
}

export function CompsCriteria({ stoneTypeOptions }: CompsCriteriaProps) {
  const {
    stoneType,
    origin,
    treatment,
    search,
    caratRange,
    certifiedOnly,
    setStoneType,
    setOrigin,
    setTreatment,
    setSearch,
    setCaratRange,
    setCertifiedOnly,
    resetFilters,
  } = useFilters();

  const originOptions = useScopedOptions(stoneType, origin, setOrigin, getOriginOptionsForType);
  const treatmentOptions = useScopedOptions(stoneType, treatment, setTreatment, getTreatmentOptionsForType);

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the typed value only
  }, [searchInput]);

  // A URL can only carry the resolved band, so back-derive the target from
  // its midpoint on load. Round-trips well enough to be legible when a
  // counterparty opens a shared link.
  const bounded = caratRange[0] > CARAT_MIN || caratRange[1] < CARAT_MAX;
  const [caratTarget, setCaratTarget] = useState(
    bounded ? ((caratRange[0] + caratRange[1]) / 2).toFixed(2) : ""
  );
  const [tolerance, setTolerance] = useState<string>(DEFAULT_TOLERANCE);

  const applyCarat = (targetRaw: string, tolPct: string) => {
    const target = Number(targetRaw);
    if (!targetRaw.trim() || Number.isNaN(target) || target <= 0) {
      setCaratRange([CARAT_MIN, CARAT_MAX]);
      return;
    }
    const pct = Number(tolPct) / 100;
    setCaratRange([
      Number((target * (1 - pct)).toFixed(2)),
      Number((target * (1 + pct)).toFixed(2)),
    ]);
  };

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Describe the stone — e.g. padparadscha, cornflower, Mahenge, no heat"
          aria-label="Search comparable sales by listing text"
          className="h-14 rounded-lg pl-11 text-lg"
        />
      </div>
      {/* The structured fields below can't express trade vocabulary, so free
          text stays first-class rather than an afterthought. */}
      <p className="-mt-2 text-xs text-muted-foreground">
        Free text searches the listing itself — useful for trade terms the structured fields don&rsquo;t
        capture. Leave it blank to match on the criteria alone.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Species">
          <Select value={stoneType} onValueChange={setStoneType}>
            <SelectTrigger className="h-10 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stoneTypeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-base">
                  {o.label} ({o.count.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Carat">
          <div className="flex gap-2">
            <Input
              value={caratTarget}
              onChange={(e) => {
                setCaratTarget(e.target.value);
                applyCarat(e.target.value, tolerance);
              }}
              inputMode="decimal"
              placeholder="e.g. 2.3"
              aria-label="Target carat weight"
              className="h-10 flex-1 text-base"
            />
            <Select
              value={tolerance}
              onValueChange={(v) => {
                setTolerance(v);
                applyCarat(caratTarget, v);
              }}
            >
              <SelectTrigger className="h-10 w-24 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOLERANCES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-base">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>

        <Field label="Origin">
          <Select value={origin} onValueChange={setOrigin}>
            <SelectTrigger className="h-10 w-full text-base">
              <SelectValue placeholder="Any origin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any origin</SelectItem>
              {originOptions.map((name) => (
                <SelectItem key={name} value={name} className="text-base">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Treatment">
          <Select value={treatment} onValueChange={setTreatment}>
            <SelectTrigger className="h-10 w-full text-base">
              <SelectValue placeholder="Any treatment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any treatment</SelectItem>
              {treatmentOptions.map((name) => (
                <SelectItem key={name} value={name} className="text-base">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="flex items-center gap-3">
          <Checkbox
            id="comps-certified"
            checked={certifiedOnly}
            onCheckedChange={(c) => setCertifiedOnly(c === true)}
            className="size-4.5"
          />
          <Label htmlFor="comps-certified" className="text-base font-normal">
            Certified only
          </Label>
          <span className="text-xs text-muted-foreground">· treatment is seller-stated, not verified</span>
        </div>

        <div className="flex items-center gap-3">
          {caratRange[0] > CARAT_MIN || caratRange[1] < CARAT_MAX ? (
            <span className="text-sm text-muted-foreground">
              matching{" "}
              <span className="font-medium text-foreground">
                {caratRange[0]} – {caratRange[1]}ct
              </span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">all weights</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setCaratTarget("");
              setTolerance(DEFAULT_TOLERANCE);
              resetFilters();
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
