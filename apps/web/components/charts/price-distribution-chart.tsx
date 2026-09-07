"use client";

import { useMemo, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/lib/filter-context";
import { getPriceDistribution } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";
import { CompSetQuality } from "@/components/comps/comp-set-quality";

const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
  bar: "#ddb049",
  marker: "#9b9fa3",
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Compact money for axis ticks, where "$1,250" costs more room than it earns.
function compactUsd(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

// The comparable-sales panel: for whatever the current filters describe,
// what did those stones actually sell for? This is the part that needs no
// model — it shows real transactions and lets the reader judge comparability
// themselves, which is the honest thing to do while quality attributes
// (colour, cut grade) remain underivable from the data we have.
interface PriceDistributionChartProps {
  // Comps mode also wants a verdict on how trustworthy the set is; rendering
  // it here reuses this component's single fetch instead of issuing a second.
  showQuality?: boolean;
}

export function PriceDistributionChart({ showQuality = false }: PriceDistributionChartProps) {
  const { stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly } = useFilters();

  const { data, loading, error, retry } = useAsyncData(
    () => getPriceDistribution({ stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly }),
    [stoneType, origin, treatment, search, caratRange, priceRange, certifiedOnly]
  );

  const option = useMemo(() => {
    if (!data) return {} as EChartsOption;

    // Bins are equal-width in log space (see the SQL), so label each bar by
    // its lower bound and let the tooltip carry the exact range.
    const labels = data.bins.map((b) => b.binLow);
    const counts = data.bins.map((b) => b.saleCount);

    // Percentile markers land on whichever bin contains them.
    const binOf = (price: number) => {
      const i = data.bins.findIndex((b) => price >= b.binLow && price <= b.binHigh);
      return i === -1 ? null : i;
    };
    const markers = [
      { name: "p25", price: data.p25 },
      { name: "median", price: data.median },
      { name: "p75", price: data.p75 },
    ]
      .map((m) => ({ ...m, idx: binOf(m.price) }))
      .filter((m): m is { name: string; price: number; idx: number } => m.idx !== null);

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 56, right: 24, top: 28, bottom: 44 },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: {
          color: THEME.mutedInk,
          formatter: (v: string) => compactUsd(Number(v)),
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
          const items = params as unknown as Array<{ dataIndex: number; data: number }>;
          if (items.length === 0) return "";
          const bin = data.bins[items[0].dataIndex];
          const n = items[0].data;
          return `<div style="font-weight:600;margin-bottom:2px">${usd.format(bin.binLow)} – ${usd.format(bin.binHigh)}</div>
            <div>${n.toLocaleString()} sale${n === 1 ? "" : "s"}</div>`;
        },
      },
      series: [
        {
          type: "bar",
          name: "Sales",
          barMaxWidth: 32,
          itemStyle: { color: THEME.bar, borderRadius: [4, 4, 0, 0] },
          data: counts,
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: THEME.marker, type: "dashed", width: 1 },
            label: {
              color: THEME.mutedInk,
              fontSize: 10,
              formatter: (p: { name: string }) => p.name,
            },
            data: markers.map((m) => ({ xAxis: m.idx, name: m.name })),
          },
        },
      ],
    };

    return built;
  }, [data]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <p className="text-lg font-medium text-foreground">Comparable Sales</p>
        <p className="text-sm text-muted-foreground">
          {data
            ? `${data.totalCount.toLocaleString()} matching sales · what they actually sold for`
            : "What matching stones actually sold for"}
        </p>
      </div>

      {data && showQuality ? <CompSetQuality n={data.totalCount} p25={data.p25} p75={data.p75} /> : null}

      {data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="25th pct" value={usd.format(data.p25)} />
          <Stat label="Median" value={usd.format(data.median)} emphasis />
          <Stat label="75th pct" value={usd.format(data.p75)} />
          <Stat label="Median $/ct" value={usd.format(data.medianPricePerCarat)} />
        </div>
      ) : null}

      {error ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>Failed to load comparable sales — usually a transient database timeout.</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : loading && !data ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          Loading comparable sales…
        </div>
      ) : !data ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
          <span>No sales match these filters.</span>
          <span className="text-xs">Widen the carat or price range, or clear the search.</span>
        </div>
      ) : (
        <>
          <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
          <p className="text-xs text-muted-foreground">
            Price buckets are log-scaled — sold prices span {usd.format(data.minPrice)} to{" "}
            {usd.format(data.maxPrice)}, so linear buckets would collapse almost everything into one bar.
            These are real completed sales, not appraisals; comparability beyond species, weight and origin
            is yours to judge.
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-border/60 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          emphasis
            ? "text-lg font-semibold tabular-nums text-foreground"
            : "text-lg tabular-nums text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
