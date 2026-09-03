"use client";

import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/lib/filter-context";
import { getTopPriceOutliers } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

// A ranked list, not a chart. "Most expensive" isn't the same unit as the
// trend's $/carat lines (raw price vs. per-carat), and overlaying it on that
// chart would mean either a second y-axis (never — see dataviz rules) or
// silently switching the outliers' ranking metric to match. A leaderboard
// with photos is also just more legible for "spot the exceptional sale" than
// hunting for a highlighted dot in a scatter.
export function TopSalesLeaderboard() {
  const { stoneType, origin, color, caratRange, priceRange, certifiedOnly } = useFilters();
  const {
    data: fetchedOutliers,
    loading,
    error,
    retry,
  } = useAsyncData(
    () => getTopPriceOutliers({ stoneType, origin, color, caratRange, priceRange, certifiedOnly }),
    [stoneType, origin, color, caratRange, priceRange, certifiedOnly]
  );
  const outliers = fetchedOutliers ?? [];

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <p className="text-lg font-medium text-foreground">Most Expensive Sales</p>
        <p className="text-sm text-muted-foreground">
          Top {outliers.length || ""} confirmed sales matching current filters
        </p>
      </div>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>Failed to load — this is usually a transient database timeout.</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : loading && outliers.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : outliers.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          No sales match the current filters.
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-border/40">
          {outliers.map((sale, i) => (
            <li key={sale.sourceUrl} className="flex items-center gap-4 py-3">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                {sale.imageUrl ? (
                  <Image
                    src={sale.imageUrl}
                    alt={sale.stoneType ?? "Gemstone"}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {sale.stoneType ?? "Unclassified"}
                  </span>
                  {sale.colorCategory ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{sale.colorCategory}</span>
                  ) : null}
                  {sale.isCertified ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Certified
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {sale.weightCarats.toFixed(2)}ct
                  {sale.origin ? ` · ${sale.origin}` : ""}
                  {sale.auctionStartsAt ? ` · ${dateFormatter.format(new Date(sale.auctionStartsAt))}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className="font-medium tabular-nums text-foreground">
                  {currencyFormatter.format(sale.priceUsd)}
                </span>
                <a
                  href={sale.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  View listing
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
