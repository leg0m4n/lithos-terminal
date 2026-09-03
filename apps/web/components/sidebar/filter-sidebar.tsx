"use client";

import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
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
import { getOriginOptionsForType, type StoneTypeOption } from "@/lib/market-data";

interface FilterSidebarProps {
  stoneTypeOptions: StoneTypeOption[];
}

export function FilterSidebar({ stoneTypeOptions }: FilterSidebarProps) {
  const {
    stoneType,
    origin,
    caratRange,
    priceRange,
    certifiedOnly,
    setOrigin,
    setCaratRange,
    setPriceRange,
    setCertifiedOnly,
    resetFilters,
  } = useFilters();

  const [originOptions, setOriginOptions] = useState<string[]>([]);

  // Origins are scoped to the selected stone type (a Sapphire buyer
  // shouldn't see Tanzanite-only origins) — a live scoped query, since there
  // is no longer a full client-side dataset to derive this from.
  useEffect(() => {
    let cancelled = false;
    getOriginOptionsForType(stoneType).then((options) => {
      if (cancelled) return;
      setOriginOptions(options);
      // A previously-picked origin can go stale the moment the stone type
      // changes — silently filtering everything out otherwise.
      if (origin !== "all" && !options.includes(origin)) {
        setOrigin("all");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin/setOrigin deliberately excluded: this only re-runs on stoneType change, not on every origin pick
  }, [stoneType]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-7 overflow-y-auto border-r border-sidebar-border bg-sidebar px-6 py-7 text-sidebar-foreground">
      <Logo />

      <Separator className="bg-sidebar-border" />

      <StoneTypeNav options={stoneTypeOptions} />

      <Separator className="bg-sidebar-border" />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
          FILTERS
        </h2>
        <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 px-2 text-sm">
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

