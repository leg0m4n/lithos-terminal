"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useFilters } from "@/lib/filter-context";
import type { StoneTypeOption } from "@/lib/market-data";

interface StoneTypeNavProps {
  options: StoneTypeOption[];
}

// Vertical list rather than horizontal tabs: the type distribution is a long
// tail (Garnet/Sapphire/Ruby lead today, but which type leads shifts as the
// sweep runs) and a horizontal strip can't hold 15+ entries without
// overflowing or truncating labels. The sidebar is already vertical.
export function StoneTypeNav({ options }: StoneTypeNavProps) {
  const { stoneType, setStoneType } = useFilters();
  const total = options.reduce((sum, o) => sum + o.count, 0);

  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
        STONE TYPE
      </h2>
      <div className="flex flex-col gap-0.5">
        <NavRow
          label="All Stones"
          count={total}
          active={stoneType === "all"}
          onClick={() => setStoneType("all")}
        />
      </div>
      <ScrollArea className="h-64">
        <div className="flex flex-col gap-0.5 pr-3">
          {options.map((opt) => (
            <NavRow
              key={opt.value}
              label={opt.label}
              count={opt.count}
              active={stoneType === opt.value}
              onClick={() => setStoneType(opt.value)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function NavRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-base transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
        {count.toLocaleString()}
      </span>
    </button>
  );
}
