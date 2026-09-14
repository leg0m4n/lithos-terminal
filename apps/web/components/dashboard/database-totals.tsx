"use client";

import { getDatabaseTotals } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";

// Whole-dataset scale, shown as plain figures rather than a chart: there is
// exactly one value per measure, and a one-bar bar chart is just a number
// wearing an axis.
//
// This panel deliberately IGNORES the sidebar filters — it answers "how much
// market is in this database at all", which is the one question on the page
// that shouldn't change when you pick a stone type. Because it never
// re-queries on filter change it also fetches once per mount (empty deps),
// unlike every other panel here.
export function DatabaseTotals() {
  const { data, loading, error } = useAsyncData(() => getDatabaseTotals(), []);

  if (error || (!loading && !data)) return null;

  // Gross turnover is the only FIGURE here. The sale count is deliberately
  // demoted to the context line even though it's the more obvious headline:
  // the sidebar already shows it ("sales on record"), and two identical
  // 130,067s side by side in the default view read as a rendering bug. The
  // sidebar's copy is search-scoped, so it diverges as soon as you type —
  // this one never does, which is the point.
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <Figure label="Gross turnover" value={data ? formatUsd(data.grossUsd) : "—"} />
      <span className="text-xs text-muted-foreground">
        {/* Not "rows scraped": usable sold lots only — the set the charts
            actually price. Unsold lots and the excluded junk classes
            (mystery boxes, gram-weight jewelry, multi-stone parcels) never
            enter, so this runs a few thousand below the raw gemstone_sales
            count and the difference is intentional. */}
        {data ? `across ${data.totalSales.toLocaleString()} sales` : ""}
        {data?.oldest && data?.newest
          ? ` · ${spanFormatter.format(new Date(data.oldest))} – ${spanFormatter.format(new Date(data.newest))}`
          : ""}
        {" · whole database, ignores filters"}
      </span>
    </div>
  );
}

const spanFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short" });

// Full dollars, not compact — the whole point of this figure is to see the
// actual magnitude, and it only renders once.
function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-lg font-medium tabular-nums text-foreground">{value}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  );
}
