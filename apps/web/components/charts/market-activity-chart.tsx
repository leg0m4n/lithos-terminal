"use client";

import { useMemo, useState, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import { getMarketActivity, type ActivityBucket, type TimeBucket } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";

const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
  bar: "#ddb049",
  barPartial: "#5b6165",
};

const monthFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

// Gross turnover spans four orders of magnitude across buckets and filters
// (a filtered day can be $300, an unfiltered month $800k), so axis ticks and
// headline figures get compact notation and full precision goes in the
// tooltip.
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const exactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Deal count and gross USD are both "volume" but answer different questions,
// and they genuinely disagree in this market: the mean sale is ~$46, so one
// five-figure stone outweighs a thousand cheap lots and a record-count month
// can be a weak dollar month.
//
// They are two measures on incomparable scales, so this is a TOGGLE over one
// y-axis rather than count-bars plus a dollar line on a second axis. A
// dual-axis chart lets whoever picks the two scales decide which measure
// "leads" — the crossover points are an artifact of that choice, not of the
// data. The tooltip carries both measures at every bucket, so switching is
// only ever about which one gets the axis.
type Measure = "deals" | "usd";

const MEASURES: Record<Measure, { label: string; axisName: string }> = {
  deals: { label: "Deals", axisName: "Sales" },
  usd: { label: "USD volume", axisName: "Gross USD" },
};

// A bucket at the very start or very end of the range that holds far fewer
// sales than the typical bucket is almost certainly incomplete scrape
// coverage, not a real collapse in trading. dredge-history sweeps the site's
// product-ID space backwards from a start_id ~60 days below the live
// ceiling, so the newest window is deliberately unswept and the oldest is
// wherever the backward sweep has currently reached.
//
// Only the leading and trailing runs are ever flagged — a genuinely quiet
// month in the middle of the series is real data and must stay unmarked.
//
// Deliberately generous, because the two failure modes aren't symmetric: an
// unflagged partial bucket reads as a real collapse in trading (July 2026
// is ~half-swept and at 0.6 it slipped through as "complete"), whereas an
// over-flagged bucket just carries a caveat it didn't strictly need.
//
// Always fed DEAL COUNTS, never gross USD, even when the chart is showing
// dollars. Coverage is a question about how many listings the scraper has
// reached, and counts scale with that directly; gross doesn't — a single
// five-figure stone can lift a half-swept month above the dollar median and
// hide the gap, while a fully-swept month of cheap lots would trip it.
const PARTIAL_COVERAGE_RATIO = 0.75;

function findPartialEdges(counts: number[]): boolean[] {
  const flags = counts.map(() => false);
  if (counts.length < 3) return flags;

  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * PARTIAL_COVERAGE_RATIO;

  for (let i = 0; i < counts.length && counts[i] < threshold; i++) flags[i] = true;
  for (let i = counts.length - 1; i >= 0 && counts[i] < threshold; i--) flags[i] = true;

  return flags;
}

export function MarketActivityChart() {
  const { stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly } = useFilters();
  const [bucket, setBucket] = useState<TimeBucket>("month");
  const [measure, setMeasure] = useState<Measure>("deals");

  const {
    data: fetched,
    loading,
    error,
    retry,
  } = useAsyncData(
    () => getMarketActivity({ stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly }, bucket),
    [stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly, bucket]
  );
  const buckets = useMemo<ActivityBucket[]>(() => fetched ?? [], [fetched]);

  const partialFlags = useMemo(
    () => findPartialEdges(buckets.map((b) => b.saleCount)),
    [buckets]
  );

  const { totalSales, totalUsd, completeTotal, completeUsd, partialCount } = useMemo(() => {
    let complete = 0;
    let completeGross = 0;
    let partial = 0;
    buckets.forEach((b, i) => {
      if (partialFlags[i]) {
        partial += 1;
      } else {
        complete += b.saleCount;
        completeGross += b.grossUsd;
      }
    });
    return {
      totalSales: buckets.reduce((sum, b) => sum + b.saleCount, 0),
      totalUsd: buckets.reduce((sum, b) => sum + b.grossUsd, 0),
      completeTotal: complete,
      completeUsd: completeGross,
      partialCount: partial,
    };
  }, [buckets, partialFlags]);

  const formatBucket = bucket === "month" ? monthFormatter : dayFormatter;

  // Note `measure` is absent from the fetch deps above on purpose — the RPC
  // returns both measures in one payload, so switching is a pure re-render
  // with no round trip.
  const valueOf = (b: ActivityBucket) => (measure === "usd" ? b.grossUsd : b.saleCount);

  const option = useMemo(() => {
    const labels = buckets.map((b) => b.bucket);

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 64, right: 24, top: 24, bottom: 64 },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: {
          color: THEME.mutedInk,
          formatter: (v: string) => formatBucket.format(new Date(v)),
          hideOverlap: true,
        },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: MEASURES[measure].axisName,
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLabel: {
          color: THEME.mutedInk,
          formatter: (v: number) => (measure === "usd" ? compactUsd.format(v) : v.toLocaleString()),
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: THEME.gridline } },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 16,
          bottom: 8,
          borderColor: "transparent",
          backgroundColor: "rgba(255,255,255,0.03)",
          fillerColor: "rgba(221,176,73,0.18)",
          handleStyle: { color: THEME.ink, borderColor: THEME.ink },
          textStyle: { color: THEME.mutedInk },
        },
      ],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        backgroundColor: THEME.tooltipBg,
        borderColor: THEME.tooltipBorder,
        borderWidth: 1,
        extraCssText: "border-radius: 8px;",
        textStyle: { color: THEME.ink },
        // Both measures appear at every bucket regardless of which one holds
        // the axis, with the active one first. That's what makes the toggle
        // safe to use as a toggle: you never lose the other number, so you
        // can't misread a count peak as a dollar peak.
        formatter: (params) => {
          const items = params as unknown as Array<{
            axisValue: string;
            data: { count: number; gross: number; partial?: boolean };
          }>;
          if (items.length === 0) return "";
          const it = items[0];
          const label = formatBucket.format(new Date(it.axisValue));
          const { count, gross } = it.data;

          const deals = `${count.toLocaleString()} sale${count === 1 ? "" : "s"}`;
          const dollars = exactUsd.format(gross);
          const lead = measure === "usd" ? dollars : deals;
          const secondary = measure === "usd" ? deals : dollars;
          // Mean per deal is the whole reason the two measures diverge —
          // showing it makes a dollar spike legible as "one big stone" vs
          // "a lot of stones".
          const mean = count > 0 ? `${exactUsd.format(gross / count)} avg per sale` : "";

          const warn = it.data.partial
            ? `<div style="color:#e0a03a;font-size:11px;margin-top:6px;max-width:220px;white-space:normal">Partial scrape coverage — this bucket is not fully swept yet, so both figures are undercounts, not a real drop.</div>`
            : "";
          return `<div style="font-weight:600;margin-bottom:2px">${label}</div>
            <div style="font-weight:600">${lead}</div>
            <div style="color:${THEME.mutedInk}">${secondary}</div>
            ${mean ? `<div style="color:${THEME.mutedInk};font-size:11px;margin-top:2px">${mean}</div>` : ""}${warn}`;
        },
      },
      series: [
        {
          type: "bar",
          name: MEASURES[measure].axisName,
          barMaxWidth: 40,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: buckets.map((b, i) => ({
            value: valueOf(b),
            // Carried on every point so the tooltip can show both measures
            // without reaching back into `buckets` by index.
            count: b.saleCount,
            gross: b.grossUsd,
            partial: partialFlags[i],
            itemStyle: {
              color: partialFlags[i] ? THEME.barPartial : THEME.bar,
              opacity: partialFlags[i] ? 0.55 : 1,
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
      ],
    };

    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- valueOf is derived from `measure`, which is listed
  }, [buckets, partialFlags, formatBucket, measure]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">
            {stoneType === "all" ? "All Stones" : stoneType} — Market Activity
          </p>
          <p className="text-sm text-muted-foreground">
            {MEASURES[measure].label} per {bucket} · {totalSales.toLocaleString()} sales ·{" "}
            {exactUsd.format(totalUsd)} gross
            {partialCount > 0
              ? ` · fully-swept ${bucket}s only: ${completeTotal.toLocaleString()} sales, ${exactUsd.format(completeUsd)}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MeasureToggle value={measure} onChange={setMeasure} />
          <BucketToggle value={bucket} onChange={setBucket} />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-y border-border/60 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: THEME.bar }} />
            Fully swept
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-sm"
              style={{ backgroundColor: THEME.barPartial, opacity: 0.55 }}
            />
            Partial coverage — undercount, not a real drop
          </span>
          <span>· Counted by auction start date</span>
        </div>
        {partialCount > 0 ? (
          <div className="text-amber-500">
            The {partialCount} greyed {bucket}
            {partialCount === 1 ? "" : "s"} at the edges are scrape-coverage artifacts: dredge-history sweeps
            backwards from a cutoff ~60 days below the site&rsquo;s newest listings, so the most recent window
            is deliberately unswept and the oldest is wherever the sweep has currently reached. Read the trend
            from the gold bars only.
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>Failed to load activity — this is usually a transient database timeout.</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : loading && buckets.length === 0 ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
          Loading activity…
        </div>
      ) : buckets.length === 0 ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
          No sales match the current filters.
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
      )}
    </Card>
  );
}

function MeasureToggle({ value, onChange }: { value: Measure; onChange: (v: Measure) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {(["deals", "usd"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {MEASURES[opt].label}
        </button>
      ))}
    </div>
  );
}

function BucketToggle({ value, onChange }: { value: TimeBucket; onChange: (v: TimeBucket) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {(["month", "day"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
