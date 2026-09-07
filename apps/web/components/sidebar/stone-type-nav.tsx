"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useFilters } from "@/lib/filter-context";
import type { StoneTypeOption } from "@/lib/market-data";

interface StoneTypeNavProps {
  options: StoneTypeOption[];
}

// Vertical list rather than horizontal tabs: the type distribution is a long
// tail (40 species and growing as the sweep widens) and a horizontal strip
// can't hold that without overflowing or truncating labels.
//
// There is deliberately no "All Stones" entry — species is always
// constrained. Comps are only meaningful within a species, and an unfiltered
// cross-species view invited exactly the apples-to-oranges reads we kept
// having to explain away.
export function StoneTypeNav({ options }: StoneTypeNavProps) {
  const { stoneType, setStoneType, search } = useFilters();
  const searching = search.trim() !== "";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
          STONE TYPE
        </h2>
        {searching ? (
          <span className="text-xs text-muted-foreground">matches for “{search.trim()}”</span>
        ) : null}
      </div>

      {options.length === 0 ? (
        <p className="px-2.5 py-3 text-sm text-muted-foreground">
          {searching ? `No species match “${search.trim()}”.` : "No species available."}
        </p>
      ) : (
        <ScrollArea className="h-64">
          <div className="flex flex-col gap-0.5 pr-3">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStoneType(opt.value)}
                aria-current={stoneType === opt.value ? "true" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-base transition-colors",
                  stoneType === opt.value
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <span className="truncate">{opt.label}</span>
                <span className="shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
                  {opt.count.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
