"use client";

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
import {
  CARAT_MAX,
  CARAT_MIN,
  describeCaratRange,
  snapToBracket,
  useFilters,
  type TreatmentStatus,
} from "@/lib/filter-context";

const TREATMENT_OPTIONS: { value: TreatmentStatus; label: string }[] = [
  { value: "unheated", label: "Unheated" },
  { value: "heated_thermal", label: "Heated (Thermal)" },
];

interface FilterSidebarProps {
  originOptions: string[];
}

export function FilterSidebar({ originOptions }: FilterSidebarProps) {
  const {
    treatmentStatuses,
    origin,
    caratRange,
    toggleTreatmentStatus,
    setOrigin,
    setCaratRange,
    resetFilters,
  } = useFilters();

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-7 border-r border-sidebar-border bg-sidebar px-6 py-7 text-sidebar-foreground">
      <Logo />

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

      <div className="flex flex-col gap-3.5">
        <Label className="text-sm text-muted-foreground">Treatment Status</Label>
        <div className="flex flex-col gap-3">
          {TREATMENT_OPTIONS.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-3">
              <Checkbox
                id={`treatment-${value}`}
                checked={treatmentStatuses.has(value)}
                onCheckedChange={() => toggleTreatmentStatus(value)}
                className="size-4.5"
              />
              <Label htmlFor={`treatment-${value}`} className="text-base font-normal">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-muted-foreground">Carat Weight</Label>
          <span className="text-sm font-medium text-foreground">
            {describeCaratRange(caratRange[0], caratRange[1])}
          </span>
        </div>
        <Slider
          min={CARAT_MIN}
          max={CARAT_MAX}
          step={0.1}
          value={caratRange}
          onValueChange={(vals) => {
            const [a, b] = vals as [number, number];
            setCaratRange([snapToBracket(a), snapToBracket(b)]);
          }}
          className="py-1.5"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0</span>
          <span>1</span>
          <span>3</span>
          <span>5</span>
          <span>10</span>
          <span>16+</span>
        </div>
      </div>
    </aside>
  );
}
