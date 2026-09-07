"use client";

import { useMemo, useState, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import { getHistoricPriceTrend } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";

type ScaleType = "linear" | "log";

// echarts-for-react's class typing predates React 19's stricter JSX element
// checks; the runtime component is unaffected, only the JSX-usability type is.
const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
};

// Fixed, never-cycled per weight tier — assigned in tier order so the same
// bracket always reads the same color across sessions/filters.
const TIER_COLORS: Record<string, string> = {
  "<1ct": "#7fb3d5",
  "1-3ct": "#ddb049",
  "3-5ct": "#b088c9",
  "5-10ct": "#d97757",
  "10ct+": "#6fbf9e",
};
const TIER_ORDER = ["<1ct", "1-3ct", "3-5ct", "5-10ct", "10ct+"];

// Below this many sales in a bucket, the median is noisy enough that it
// shouldn't visually read with the same confidence as a well-traded month —
// dimmed rather than hidden, so thin history is still visible as a hint.
const LOW_CONFIDENCE_THRESHOLD = 5;

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short" });

export function HistoricPriceChart() {
  const { stoneType, origin, caratRange, priceRange, certifiedOnly } = useFilters();
  const [scaleType, setScaleType] = useState<ScaleType>("linear");

  const {
    data: fetchedPoints,
    loading,
    error,
    retry,
  } = useAsyncData(
    () => getHistoricPriceTrend({ stoneType, origin, caratRange, priceRange, certifiedOnly }),
    [stoneType, origin, caratRange, priceRange, certifiedOnly]
  );
  // Stable reference when there's no data yet — `?? []` alone would mint a
  // new array every render and defeat the useMemo below.
  const points = useMemo(() => fetchedPoints ?? [], [fetchedPoints]);

  const totalTxns = useMemo(() => points.reduce((sum, p) => sum + p.txnCount, 0), [points]);

  const option = useMemo(() => {
    const months = [...new Set(points.map((p) => p.month))].sort();

    const lineSeries = TIER_ORDER.filter((tier) => points.some((p) => p.weightTier === tier)).map(
      (tier) => {
        const byMonth = new Map(points.filter((p) => p.weightTier === tier).map((p) => [p.month, p]));
        return {
          type: "line" as const,
          name: tier,
          xAxisIndex: 0,
          yAxisIndex: 0,
          connectNulls: true,
          showSymbol: true,
          symbolSize: 7,
          lineStyle: { color: TIER_COLORS[tier], width: 2 },
          itemStyle: { color: TIER_COLORS[tier] },
          // Category axis (see xAxis below), so each entry's position comes
          // from its index in `months` — value is just the y-number, not a
          // [x, y] pair.
          data: months.map((month) => {
            const p = byMonth.get(month);
            if (!p) return { value: null };
            const lowConfidence = p.txnCount < LOW_CONFIDENCE_THRESHOLD;
            return {
              value: p.medianPricePerCarat,
              itemStyle: lowConfidence ? { opacity: 0.35 } : undefined,
              symbolSize: lowConfidence ? 5 : 7,
              txnCount: p.txnCount,
            };
          }),
        };
      }
    );

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 72, right: 24, top: 32, bottom: 64 },
      // Category, not time: the data is already bucketed into discrete
      // calendar months, not a continuous stream of timestamps. A time axis
      // was auto-generating irregular day/week ticks that didn't line up
      // with the actual (monthly) data points, and made the crosshair show
      // a raw interpolated timestamp instead of a clean month label.
      xAxis: {
        type: "category",
        data: months,
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: {
          color: THEME.mutedInk,
          formatter: (v: string) => monthFormatter.format(new Date(v)),
          hideOverlap: true,
        },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: scaleType === "log" ? "log" : "value",
        min: scaleType === "log" ? undefined : 0,
        name: "Median $/carat",
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLabel: { color: THEME.mutedInk, formatter: (v: number) => `$${v}` },
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
      legend: {
        top: 0,
        textStyle: { color: THEME.mutedInk },
        data: lineSeries.map((s) => s.name),
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        confine: true,
        backgroundColor: THEME.tooltipBg,
        borderColor: THEME.tooltipBorder,
        borderWidth: 1,
        extraCssText: "border-radius: 8px;",
        textStyle: { color: THEME.ink },
        formatter: (params) => {
          const items = params as unknown as Array<{
            seriesName: string;
            axisValue: string;
            data: { value: number | null; txnCount?: number };
            marker: string;
          }>;
          if (items.length === 0) return "";
          const date = monthFormatter.format(new Date(items[0].axisValue));
          const lines = items
            .filter((it) => it.data.value != null)
            .map((it) => {
              const price = it.data.value as number;
              const count = it.data.txnCount;
              return `<div>${it.marker}${it.seriesName}: <strong>${priceFormatter.format(price)}/ct</strong>${
                count != null ? ` <span style="color:${THEME.mutedInk}">(${count} sale${count === 1 ? "" : "s"})</span>` : ""
              }</div>`;
            });
          return `<div style="font-weight:600;margin-bottom:4px">${date}</div>${lines.join("")}`;
        },
      },
      series: lineSeries,
    };

    return built;
  }, [points, scaleType]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">
            {stoneType === "all" ? "All Stones" : stoneType} — Historic Price Trend
          </p>
          <p className="text-sm text-muted-foreground">
            Median $/carat by weight tier · {totalTxns.toLocaleString()} sales
          </p>
        </div>
        <ScaleToggle value={scaleType} onChange={setScaleType} />
      </div>
      <ChartCaption />
      {error ? (
        <div className="flex h-[460px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>Failed to load the trend — this is usually a transient database timeout.</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : loading && points.length === 0 ? (
        <div className="flex h-[460px] items-center justify-center text-sm text-muted-foreground">
          Loading trend…
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-[460px] items-center justify-center text-sm text-muted-foreground">
          No sales match the current filters.
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 460, width: "100%" }} notMerge lazyUpdate />
      )}
    </Card>
  );
}

function ScaleToggle({ value, onChange }: { value: ScaleType; onChange: (v: ScaleType) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {(["linear", "log"] as const).map((opt) => (
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

function ChartCaption() {
  return (
    <div className="flex flex-col gap-2 border-y border-border/60 py-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-4">
        <span>One line per weight tier — carat brackets, not raw price, so sizes are never compared directly.</span>
        <span>· Faint points = fewer than {LOW_CONFIDENCE_THRESHOLD} sales that month (noisy median)</span>
        <span>· Sale volume lives in its own Market Activity chart below</span>
      </div>
      {/* Stated permanently, not as a fixable filter state: this is the real
          precision ceiling of the dataset today. */}
      <div>
        Precise on size and time, deliberately general on quality: each point blends stones of very different
        colour, clarity and cut, which for one species can span a 10x+ price range on its own. Read it as a
        market-level trend, not a valuation for any individual stone.
      </div>
    </div>
  );
}
