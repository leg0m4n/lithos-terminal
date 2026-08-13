"use client";

import { useMemo, useState, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import type { MarketPoint } from "@/lib/market-data";

type Status = MarketPoint["status"];
type ScaleType = "linear" | "log";
type SpreadBand = "underpriced" | "fair" | "overpriced";

// echarts-for-react's class typing predates React 19's stricter JSX element
// checks; the runtime component is unaffected, only the JSX-usability type is.
const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

// Shape = lifecycle status. Kept independent of color so the two signals
// (where a listing is in its life vs. how good a deal it is) never collide.
const STATUS_SHAPE: Record<Status, { symbol: string; label: string }> = {
  active: { symbol: "circle", label: "Active" },
  price_drop: { symbol: "triangle", label: "Price Drop" },
  sold: { symbol: "diamond", label: "Sold" },
  delisted: { symbol: "rect", label: "Delisted" },
};

// Color = spread vs. predicted wholesale. This is a diverging signal (good
// deal / fair / bad deal), and green/red is the requested convention — but
// the dataviz palette validator flags green vs. red as a hard protanopia/
// deuteranopia confusion (ΔE 5.6, below even the lenient floor), so the
// mark also carries a border-style secondary encoding (see borderTypeFor)
// rather than relying on hue alone.
const SPREAD_META: Record<SpreadBand, { color: string; label: string }> = {
  underpriced: { color: "#0ca30c", label: "Undervalued >20%" },
  fair: { color: "#9b9fa3", label: "Fair Value" },
  overpriced: { color: "#ec835a", label: "Overpriced" },
};

function borderTypeFor(band: SpreadBand): "solid" | "dashed" {
  return band === "overpriced" ? "dashed" : "solid";
}

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  surfaceRing: "#25282b",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
  lineColor: "rgba(255,255,255,0.16)",
  gold: "#ddb049",
};

const MIN_CARAT_FOR_SIZE = 3;
const MAX_CARAT_FOR_SIZE = 15;
const MIN_SYMBOL_SIZE = 6;
const MAX_SYMBOL_SIZE = 20;

function symbolSizeForCarat(carats: number): number {
  if (carats <= MIN_CARAT_FOR_SIZE) return MIN_SYMBOL_SIZE;
  if (carats >= MAX_CARAT_FOR_SIZE) return MAX_SYMBOL_SIZE;
  const t = (carats - MIN_CARAT_FOR_SIZE) / (MAX_CARAT_FOR_SIZE - MIN_CARAT_FOR_SIZE);
  return MIN_SYMBOL_SIZE + t * (MAX_SYMBOL_SIZE - MIN_SYMBOL_SIZE);
}

function spreadBand(askingPriceUsd: number, predictedWholesaleUsd: number): SpreadBand {
  const spreadPct = (predictedWholesaleUsd - askingPriceUsd) / predictedWholesaleUsd;
  if (spreadPct > 0.2) return "underpriced";
  if (spreadPct < 0) return "overpriced";
  return "fair";
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const ROLLING_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Trailing 30-day median price/carat across still-listed stones (active or
// price_drop — i.e. not sold or delisted), sampled at each day a live event
// actually occurred.
function buildRollingMedian(livePoints: MarketPoint[]): [number, number][] {
  if (livePoints.length === 0) return [];

  const sorted = [...livePoints].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const withTime = sorted.map((p) => ({ t: new Date(p.recordedAt).getTime(), p }));
  const days = [...new Set(withTime.map(({ t }) => Math.floor(t / DAY_MS)))].sort((a, b) => a - b);

  const result: [number, number][] = [];
  for (const day of days) {
    const windowEnd = (day + 1) * DAY_MS - 1;
    const windowStart = windowEnd - ROLLING_WINDOW_DAYS * DAY_MS;
    const windowValues = withTime
      .filter(({ t }) => t >= windowStart && t <= windowEnd)
      .map(({ p }) => p.pricePerCarat);
    if (windowValues.length === 0) continue;
    result.push([windowEnd, median(windowValues)]);
  }
  return result;
}

interface ScatterPointDatum {
  value: [number, number];
  symbol: string;
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number; borderType: "solid" | "dashed" };
  point: MarketPoint;
  band: SpreadBand;
}

interface HeroScatterChartProps {
  points: MarketPoint[];
}

export function HeroScatterChart({ points }: HeroScatterChartProps) {
  const { treatmentStatuses, origin, caratRange } = useFilters();
  const [scaleType, setScaleType] = useState<ScaleType>("linear");

  const filtered = useMemo(() => {
    return points.filter((p) => {
      if (!treatmentStatuses.has(p.treatmentStatus)) return false;
      if (origin !== "all" && p.origin !== origin) return false;
      if (p.weightCarats < caratRange[0] || p.weightCarats > caratRange[1]) return false;
      return true;
    });
  }, [points, treatmentStatuses, origin, caratRange]);

  const option = useMemo(() => {
    const byStone = new Map<string, MarketPoint[]>();
    for (const p of filtered) {
      const arr = byStone.get(p.gemstoneId);
      if (arr) arr.push(p);
      else byStone.set(p.gemstoneId, [p]);
    }

    // One muted step-line per stone traces its own price history; the
    // scatter layer on top carries the real signal (color + shape + size).
    const lineSeries = [...byStone.values()]
      .filter((stonePoints) => stonePoints.length > 1)
      .map((stonePoints) => ({
        type: "line" as const,
        step: "end" as const,
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { color: THEME.lineColor, width: 2 },
        data: stonePoints.map(
          (p) => [new Date(p.recordedAt).getTime(), p.pricePerCarat] as [number, number]
        ),
        z: 1,
      }));

    const scatterData: ScatterPointDatum[] = filtered.map((p) => {
      const band = spreadBand(p.askingPriceUsd, p.predictedWholesaleUsd);
      return {
        value: [new Date(p.recordedAt).getTime(), p.pricePerCarat],
        symbol: STATUS_SHAPE[p.status].symbol,
        symbolSize: symbolSizeForCarat(p.weightCarats),
        itemStyle: {
          color: SPREAD_META[band].color,
          borderColor: THEME.surfaceRing,
          borderWidth: 2,
          borderType: borderTypeFor(band),
        },
        point: p,
        band,
      };
    });

    const livePoints = filtered.filter((p) => p.status === "active" || p.status === "price_drop");
    const medianData = buildRollingMedian(livePoints);

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 72, right: 24, top: 24, bottom: 72 },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: { color: THEME.mutedInk },
        splitLine: { show: false },
      },
      yAxis: {
        type: scaleType === "log" ? "log" : "value",
        min: scaleType === "log" ? undefined : 0,
        name: "Asking Price / Carat (USD)",
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLabel: { color: THEME.mutedInk, formatter: (v: number) => formatCurrency(v) },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: THEME.gridline } },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 20,
          bottom: 12,
          borderColor: "transparent",
          backgroundColor: "rgba(255,255,255,0.03)",
          fillerColor: "rgba(221,176,73,0.18)",
          handleStyle: { color: THEME.gold, borderColor: THEME.gold },
          dataBackground: {
            lineStyle: { color: THEME.mutedInk },
            areaStyle: { color: "rgba(255,255,255,0.05)" },
          },
          textStyle: { color: THEME.mutedInk },
        },
      ],
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: THEME.tooltipBg,
        borderColor: THEME.tooltipBorder,
        borderWidth: 1,
        extraCssText: "border-radius: 8px;",
        textStyle: { color: THEME.ink },
        formatter: (params) => {
          const { data } = params as unknown as { data: ScatterPointDatum };
          const p = data.point;
          const date = new Date(p.recordedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          const treatment = p.treatmentStatus === "unheated" ? "Unheated" : "Heated (Thermal)";
          const spreadPct =
            ((p.predictedWholesaleUsd - p.askingPriceUsd) / p.predictedWholesaleUsd) * 100;
          const spreadLabel = `${spreadPct >= 0 ? "-" : "+"}${Math.abs(spreadPct).toFixed(0)}% vs. wholesale`;
          return `<div style="min-width:220px">
            <div style="font-weight:600;font-size:14px;margin-bottom:2px">${formatCurrency(p.pricePerCarat)}/ct</div>
            <div style="color:${THEME.mutedInk};font-size:12px;margin-bottom:8px">${date} · ${STATUS_SHAPE[p.status].label} · ${SPREAD_META[data.band].label}</div>
            <div style="font-size:12px;line-height:1.6">
              ${p.weightCarats.toFixed(2)}ct · ${p.colorCategory}<br/>
              ${p.origin}<br/>
              ${treatment}<br/>
              Asking: ${formatCurrency(p.askingPriceUsd)}<br/>
              Predicted Wholesale: ${formatCurrency(p.predictedWholesaleUsd)}<br/>
              Spread: ${spreadLabel}
            </div>
          </div>`;
        },
      },
      series: [
        ...lineSeries,
        { type: "scatter", data: scatterData, z: 2 },
        {
          type: "line",
          data: medianData,
          showSymbol: false,
          smooth: 0.3,
          silent: true,
          tooltip: { show: false },
          lineStyle: { color: THEME.gold, width: 2, type: "dashed" },
          z: 3,
        },
      ],
    };

    return built;
  }, [filtered, scaleType]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">Time-Series Scatter Plot</p>
          <p className="text-sm text-muted-foreground">
            Asking price per carat · {filtered.length.toLocaleString()} listing events
          </p>
        </div>
        <ScaleToggle value={scaleType} onChange={setScaleType} />
      </div>
      <ChartLegend />
      <ReactECharts option={option} style={{ height: 460, width: "100%" }} notMerge lazyUpdate />
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

function ChartLegend() {
  return (
    <div className="flex flex-col gap-2 border-y border-border/60 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-muted-foreground">Status</span>
        {(Object.entries(STATUS_SHAPE) as [Status, (typeof STATUS_SHAPE)[Status]][]).map(
          ([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LegendGlyph symbol={meta.symbol} color={THEME.ink} />
              {meta.label}
            </div>
          )
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-muted-foreground">vs. Wholesale</span>
        {(Object.entries(SPREAD_META) as [SpreadBand, (typeof SPREAD_META)[SpreadBand]][]).map(
          ([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LegendGlyph symbol="circle" color={meta.color} dashed={key === "overpriced"} />
              {meta.label}
            </div>
          )
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="inline-block w-4 border-t-2 border-dashed"
            style={{ borderColor: THEME.gold }}
          />
          30-Day Median
        </div>
      </div>
    </div>
  );
}

function LegendGlyph({
  symbol,
  color,
  dashed = false,
}: {
  symbol: string;
  color: string;
  dashed?: boolean;
}) {
  const ringStyle = dashed
    ? { outline: `1.5px dashed ${color}`, outlineOffset: 2 }
    : undefined;

  if (symbol === "triangle") {
    return (
      <span
        className="inline-block"
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `9px solid ${color}`,
        }}
      />
    );
  }
  if (symbol === "diamond") {
    return (
      <span
        className="inline-block"
        style={{ width: 8, height: 8, backgroundColor: color, transform: "rotate(45deg)" }}
      />
    );
  }
  if (symbol === "rect") {
    return <span className="inline-block" style={{ width: 9, height: 9, backgroundColor: color }} />;
  }
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 8, height: 8, backgroundColor: color, ...ringStyle }}
    />
  );
}
