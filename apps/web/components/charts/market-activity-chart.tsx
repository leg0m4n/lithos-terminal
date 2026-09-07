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
  const { stoneType, origin, color, caratRange, priceRange, certifiedOnly } = useFilters();
  const [bucket, setBucket] = useState<TimeBucket>("month");

  const {
    data: fetched,
    loading,
    error,
    retry,
  } = useAsyncData(
    () => getMarketActivity({ stoneType, origin, color, caratRange, priceRange, certifiedOnly }, bucket),
    [stoneType, origin, color, caratRange, priceRange, certifiedOnly, bucket]
  );
  const buckets = useMemo<ActivityBucket[]>(() => fetched ?? [], [fetched]);

  const partialFlags = useMemo(
    () => findPartialEdges(buckets.map((b) => b.saleCount)),
    [buckets]
  );

  const { totalSales, completeTotal, partialCount } = useMemo(() => {
    let complete = 0;
    let partial = 0;
    buckets.forEach((b, i) => {
      if (partialFlags[i]) partial += 1;
      else complete += b.saleCount;
    });
    return {
      totalSales: buckets.reduce((sum, b) => sum + b.saleCount, 0),
      completeTotal: complete,
      partialCount: partial,
    };
  }, [buckets, partialFlags]);

  const formatBucket = bucket === "month" ? monthFormatter : dayFormatter;

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
        name: "Sales",
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLabel: { color: THEME.mutedInk },
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
        formatter: (params) => {
          const items = params as unknown as Array<{
            axisValue: string;
            data: { value: number; partial?: boolean };
          }>;
          if (items.length === 0) return "";
          const it = items[0];
          const label = formatBucket.format(new Date(it.axisValue));
          const count = it.data.value;
          const warn = it.data.partial
            ? `<div style="color:#e0a03a;font-size:11px;margin-top:6px;max-width:220px;white-space:normal">Partial scrape coverage — this bucket is not fully swept yet, so the count is an undercount, not a real drop.</div>`
            : "";
          return `<div style="font-weight:600;margin-bottom:2px">${label}</div>
            <div>${count.toLocaleString()} sale${count === 1 ? "" : "s"}</div>${warn}`;
        },
      },
      series: [
        {
          type: "bar",
          name: "Sales",
          barMaxWidth: 40,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: buckets.map((b, i) => ({
            value: b.saleCount,
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
  }, [buckets, partialFlags, formatBucket]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">
            {stoneType === "all" ? "All Stones" : stoneType} — Market Activity
          </p>
          <p className="text-sm text-muted-foreground">
            Sales per {bucket} · {totalSales.toLocaleString()} total
            {partialCount > 0 ? ` · ${completeTotal.toLocaleString()} in fully-swept ${bucket}s` : ""}
          </p>
        </div>
        <BucketToggle value={bucket} onChange={setBucket} />
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
