"use client";

import { useMemo, useState, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import { filterSales, type GemstoneSale } from "@/lib/market-data";

type ScaleType = "linear" | "log";

// echarts-for-react's class typing predates React 19's stricter JSX element
// checks; the runtime component is unaffected, only the JSX-usability type is.
const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  surfaceRing: "#25282b",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
  // Reclaimed from the old "active listing" gold now that every row here is
  // a confirmed sale — one series, one accent, no legend needed.
  sold: "#ddb049",
};

const MIN_CARAT_FOR_SIZE = 1;
const MAX_CARAT_FOR_SIZE = 15;
const MIN_SYMBOL_SIZE = 6;
const MAX_SYMBOL_SIZE = 22;

function symbolSizeForCarat(carats: number): number {
  if (carats <= MIN_CARAT_FOR_SIZE) return MIN_SYMBOL_SIZE;
  if (carats >= MAX_CARAT_FOR_SIZE) return MAX_SYMBOL_SIZE;
  const t = (carats - MIN_CARAT_FOR_SIZE) / (MAX_CARAT_FOR_SIZE - MIN_CARAT_FOR_SIZE);
  return MIN_SYMBOL_SIZE + t * (MAX_SYMBOL_SIZE - MIN_SYMBOL_SIZE);
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

const treatmentLabel: Record<string, string> = {
  unheated: "Unheated",
  heated_thermal: "Heated (Thermal)",
};

interface ScatterPointDatum {
  value: [number, number]; // [auctionStartsAtMs, priceUsd]
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number };
  sale: GemstoneSale;
}

interface HistoricPriceChartProps {
  sales: GemstoneSale[];
}

export function HistoricPriceChart({ sales }: HistoricPriceChartProps) {
  const { stoneType, origin, caratRange, priceRange, certifiedOnly } = useFilters();
  const [scaleType, setScaleType] = useState<ScaleType>("linear");

  const filtered = useMemo(() => {
    return filterSales(sales, { stoneType, origin, caratRange, priceRange, certifiedOnly }).filter(
      // Can't place a point on a time axis without a timestamp.
      (s) => s.auctionStartsAt !== null
    );
  }, [sales, stoneType, origin, caratRange, priceRange, certifiedOnly]);

  const option = useMemo(() => {
    const scatterData: ScatterPointDatum[] = filtered.map((s) => ({
      value: [new Date(s.auctionStartsAt!).getTime(), s.priceUsd],
      symbolSize: symbolSizeForCarat(s.weightCarats),
      itemStyle: {
        color: THEME.sold,
        borderColor: THEME.surfaceRing,
        borderWidth: 1.5,
      },
      sale: s,
    }));

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 72, right: 24, top: 24, bottom: 72 },
      xAxis: {
        type: "time",
        name: "Auction Start",
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: { color: THEME.mutedInk },
        splitLine: { show: false },
      },
      yAxis: {
        type: scaleType === "log" ? "log" : "value",
        min: scaleType === "log" ? undefined : 0,
        name: "Sold Price (USD)",
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
          handleStyle: { color: THEME.ink, borderColor: THEME.ink },
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
        // Hover-to-reveal image + basic info card — nothing shows until the
        // pointer is over a datapoint.
        formatter: (params) => {
          const { data } = params as unknown as { data: ScatterPointDatum };
          const s = data.sale;
          const date = new Date(s.auctionStartsAt!).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          const imageHtml = s.imageUrl
            ? `<img src="${escapeHtml(s.imageUrl)}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;display:block;margin-bottom:8px" />`
            : "";
          const certLine = s.isCertified
            ? `${s.certificationLab ? escapeHtml(s.certificationLab) : "Certified"}<br/>`
            : "";
          return `<div style="min-width:200px">
            ${imageHtml}
            <div style="font-weight:600;font-size:14px;margin-bottom:2px">${formatCurrency(s.priceUsd)}</div>
            <div style="color:${THEME.mutedInk};font-size:12px;margin-bottom:8px">Auction started ${date}</div>
            <div style="font-size:12px;line-height:1.6">
              ${escapeHtml(s.stoneType ?? "Unclassified")} · ${s.weightCarats.toFixed(2)}ct<br/>
              ${s.colorCategory ? `${escapeHtml(s.colorCategory)}<br/>` : ""}
              ${s.shape ? `${escapeHtml(s.shape)}${s.cutStyle ? ` · ${escapeHtml(s.cutStyle)}` : ""}<br/>` : ""}
              ${s.clarity ? `Clarity: ${escapeHtml(s.clarity)}<br/>` : ""}
              ${s.origin ? `${escapeHtml(s.origin)}<br/>` : ""}
              ${s.treatmentStatus ? `${treatmentLabel[s.treatmentStatus]}<br/>` : ""}
              ${certLine}
            </div>
          </div>`;
        },
      },
      series: [{ type: "scatter", data: scatterData, z: 2 }],
    };

    return built;
  }, [filtered, scaleType]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">
            {stoneType === "all" ? "All Stones" : stoneType} — Historic Price Trend
          </p>
          <p className="text-sm text-muted-foreground">
            Sold price · {filtered.length.toLocaleString()} listings
          </p>
        </div>
        <ScaleToggle value={scaleType} onChange={setScaleType} />
      </div>
      <ChartCaption />
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

function ChartCaption() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-y border-border/60 py-3 text-xs text-muted-foreground">
      <span>Every point is a confirmed sale (reserve met).</span>
      <span>· Marker size = carat weight</span>
      <span>· Hover a point for photo &amp; details</span>
      <span>
        · X-axis is auction start date — GemRockAuctions doesn&apos;t expose a
        confirmed sale timestamp
      </span>
    </div>
  );
}
