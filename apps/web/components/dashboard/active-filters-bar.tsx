"use client";

import { Badge } from "@/components/ui/badge";
import { describeCaratRange, describePriceRange, useFilters } from "@/lib/filter-context";

export function ActiveFiltersBar() {
  const { stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly } = useFilters();
  const query = search.trim();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Active filters:</span>
      {query ? (
        <Badge variant="secondary" className="text-sm">
          “{query}”
        </Badge>
      ) : null}
      <Badge variant="outline" className="text-sm">
        {stoneType}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {origin === "all" ? "All Origins" : origin}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {treatment === "all" ? "Any Treatment" : treatment}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {describeCaratRange(caratRange[0], caratRange[1])}
      </Badge>
      <Badge variant="outline" className="text-sm">
        {describePriceRange(priceRange[0], priceRange[1])}
      </Badge>
      {certifiedOnly ? (
        <Badge variant="outline" className="text-sm">
          Certified Only
        </Badge>
      ) : null}
    </div>
  );
}
