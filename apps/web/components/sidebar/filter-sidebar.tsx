"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/sidebar/logo";
import { StoneTypeNav } from "@/components/sidebar/stone-type-nav";
import {
  CARAT_BRACKET_STOPS,
  describeCaratRange,
  describePriceRange,
  PRICE_BRACKET_STOPS,
  useFilters,
} from "@/lib/filter-context";
import {
  getOriginOptionsForType,
  getStoneTypeOptions,
  getTreatmentOptionsForType,
  type StoneTypeOption,
} from "@/lib/market-data";

// Typing fires queries in five components at once, so the input stays local
// and only pushes to shared filter state once you pause.
const SEARCH_DEBOUNCE_MS = 300;

interface FilterSidebarProps {
  stoneTypeOptions: StoneTypeOption[];
}

// Origin is scoped to the selected stone type: a live query that resets the
// current pick if it goes stale when the stone type changes.
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
        // A previously-picked value can go stale the moment the stone type
        // changes (e.g. "Tanzania" selected under Tanzanite, then switching
        // to Sapphire) — silently filtering everything out otherwise.
        if (value !== "all" && !opts.includes(value)) {
          setValue("all");
        }
      })
      .catch(() => {
        // Transient failure (DB timeout under write load, etc.) — leave the
        // existing options/value alone rather than resetting to "all" based
        // on no information. The dropdown just won't pick up new options
        // until the next successful fetch.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value/setValue deliberately excluded: this only re-runs on stoneType change, not on every pick
  }, [stoneType, fetcher]);

  return options;
}

export function FilterSidebar({ stoneTypeOptions }: FilterSidebarProps) {
  const {
    stoneType,
    origin,
    treatment,
    search,
    caratRange,
    priceRange,
    certifiedOnly,
    setStoneType,
    setOrigin,
    setTreatment,
    setSearch,
    setCaratRange,
    setPriceRange,
    setCertifiedOnly,
    resetFilters,
  } = useFilters();

  const originOptions = useScopedOptions(stoneType, origin, setOrigin, getOriginOptionsForType);
  const treatmentOptions = useScopedOptions(stoneType, treatment, setTreatment, getTreatmentOptionsForType);

  // Local mirror of the search box so typing stays responsive; the shared
  // (query-firing, URL-syncing) value updates on a debounce.
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the typed value only
  }, [searchInput]);

  // The species list is server-rendered for first paint, then re-queried as
  // the search changes so each species shows how many hits it holds.
  const [typeOptions, setTypeOptions] = useState(stoneTypeOptions);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return; // server already gave us the unsearched list
    }
    let cancelled = false;
    getStoneTypeOptions(search)
      .then((opts) => {
        if (cancelled) return;
        setTypeOptions(opts);
        // Species is always constrained, so a search that has no hits in the
        // current species would silently show nothing. Jump to the species
        // that actually contains the term.
        if (opts.length > 0 && !opts.some((o) => o.value === stoneType)) {
          setStoneType(opts[0].value);
        }
      })
      .catch(() => {
        /* transient — keep the last good list rather than blanking the nav */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stoneType intentionally excluded: only a search change should re-scope the list
  }, [search]);

  const totalStones = typeOptions.reduce((sum, o) => sum + o.count, 0);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-7 overflow-y-auto border-r border-sidebar-border bg-sidebar px-6 py-7 text-sidebar-foreground">
      <Logo />

      <Separator className="bg-sidebar-border" />

      {/* Search + corpus size on one row: the search is the entry point to
          comparable-sales lookup, and the count tells you how deep the
          evidence base behind it currently is. */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search sales…"
            aria-label="Search comparable sales by title"
            className="h-10 pl-8 text-base"
          />
        </div>
        <div className="flex items-baseline justify-between px-0.5">
          <span className="text-xs text-muted-foreground">
            {search.trim() ? "matching sales" : "sales on record"}
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {totalStones.toLocaleString()}
          </span>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      <StoneTypeNav options={typeOptions} />

      <Separator className="bg-sidebar-border" />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
          FILTERS
        </h2>
        <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); resetFilters(); }} className="h-7 px-2 text-sm">
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-2.5">
        <Label className="text-sm text-muted-foreground">Origin</Label>
        <Select value={origin} onValueChange={setOrigin}>
          <SelectTrigger className="h-10 w-full text-base">
            <SelectValue placeholder="All Origins" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Origins</SelectItem>
            {originOptions.map((name) => (
              <SelectItem key={name} value={name} className="text-base">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2.5">
        <Label className="text-sm text-muted-foreground">Treatment</Label>
        <Select value={treatment} onValueChange={setTreatment}>
          <SelectTrigger className="h-10 w-full text-base">
            <SelectValue placeholder="Any Treatment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Treatment</SelectItem>
            {treatmentOptions.map((name) => (
              <SelectItem key={name} value={name} className="text-base">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Not a verified attribute: ~78% of listings say "No Treatment",
            which is usually an unstated seller default rather than a lab
            finding. Useful to narrow comps, not evidence of anything. */}
        <p className="text-xs text-muted-foreground">Seller-stated, not independently verified.</p>
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="flex items-center gap-3">
        <Checkbox
          id="certified-only"
          checked={certifiedOnly}
          onCheckedChange={(checked) => setCertifiedOnly(checked === true)}
          className="size-4.5"
        />
        <Label htmlFor="certified-only" className="flex items-center gap-1.5 text-base font-normal">
          <BadgeCheck className="size-4 text-primary" />
          Certified Only
        </Label>
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-muted-foreground">Carat Weight</Label>
          <span className="text-sm font-medium text-foreground">
            {describeCaratRange(caratRange[0], caratRange[1])}
          </span>
        </div>
        <BracketRangeSlider
          stops={CARAT_BRACKET_STOPS}
          value={caratRange}
          onValueChange={setCaratRange}
          formatStop={(v, isLast) => (isLast ? `${v}+` : `${v}`)}
        />
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-muted-foreground">Price</Label>
          <span className="text-sm font-medium text-foreground">
            {describePriceRange(priceRange[0], priceRange[1])}
          </span>
        </div>
        <BracketRangeSlider
          stops={PRICE_BRACKET_STOPS}
          value={priceRange}
          onValueChange={setPriceRange}
          formatStop={(v, isLast) => (isLast ? `$${v / 1000}k+` : `$${v}`)}
        />
      </div>
    </aside>
  );
}

// Bracket edges (carat, price) aren't evenly spaced in real units — they
// follow the actual data distribution (magic-size steps, price percentiles),
// not round numbers. Driving the slider off raw values on a linear scale
// made the thumb's true position drift away from its label and made drag
// snapping look arbitrary. Operating on the stop's INDEX instead keeps every
// stop an equal-width tick, exactly matching the evenly-spaced labels below.
function BracketRangeSlider({
  stops,
  value,
  onValueChange,
  formatStop,
}: {
  stops: readonly number[];
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  formatStop: (stop: number, isLast: boolean) => string;
}) {
  const indexOfStop = (v: number) => {
    const idx = stops.indexOf(v);
    return idx === -1 ? 0 : idx;
  };
  const indices: [number, number] = [indexOfStop(value[0]), indexOfStop(value[1])];

  return (
    <>
      <Slider
        min={0}
        max={stops.length - 1}
        step={1}
        value={indices}
        onValueChange={(vals) => {
          const [a, b] = vals as [number, number];
          onValueChange([stops[a], stops[b]]);
        }}
        className="py-1.5"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        {stops.map((stop, i) => (
          <span key={stop}>{formatStop(stop, i === stops.length - 1)}</span>
        ))}
      </div>
    </>
  );
}

