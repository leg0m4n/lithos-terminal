"use client";

import { Badge } from "@/components/ui/badge";
import { describeCaratRange, useFilters } from "@/lib/filter-context";

export function ActiveFiltersBar() {
  const { treatmentStatuses, origin, caratRange } = useFilters();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Active filters:</span>
      <Badge variant="outline" className="text-sm">
        {origin === "all" ? "All Origins" : origin}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {treatmentStatuses.size === 2
          ? "All Treatments"
          : treatmentStatuses.size === 0
            ? "No Treatments Selected"
            : [...treatmentStatuses].join(", ")}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {describeCaratRange(caratRange[0], caratRange[1])}
      </Badge>
    </div>
  );
}
