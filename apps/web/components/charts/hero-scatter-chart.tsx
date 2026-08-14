"use client";

import { useMemo, useState, type ComponentType } from "react";
import EChartsReactImport, { type EChartsReactProps } from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card } from "@/components/ui/card";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import type { GemstoneSale, SaleStatus } from "@/lib/market-data";

type ScaleType = "linear" | "log";

// echarts-for-react's class typing predates React 19's stricter JSX element
// checks; the runtime component is unaffected, only the JSX-usability type is.
const ReactECharts = EChartsReactImport as unknown as ComponentType<EChartsReactProps>;

// Color = sale status. The live feed only ever reports "Active" or "Sold" —
// gold reads as "still on the market", muted gray as "gone".
const STATUS_META: Record<SaleStatus, { color: string; label: string }> = {
  active: { color: "#ddb049", label: "Active" },
  sold: { color: "#9b9fa3", label: "Sold" },
  other: { color: "#5b6165", label: "Unknown" },
};

const THEME = {
  ink: "#f1f2f3",
  mutedInk: "#9b9fa3",
  gridline: "rgba(255,255,255,0.08)",
  axisLine: "rgba(255,255,255,0.18)",
  surfaceRing: "#25282b",
  tooltipBg: "#25282b",
  tooltipBorder: "rgba(255,255,255,0.14)",
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

interface ScatterPointDatum {
  value: [number, number]; // [weightCarats, priceUsd]
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number };
  sale: GemstoneSale;
}

interface HeroScatterChartProps {
  sales: GemstoneSale[];
}

export function HeroScatterChart({ sales }: HeroScatterChartProps) {
  const { treatmentStatuses, origin, caratRange } = useFilters();
  const [scaleType, setScaleType] = useState<ScaleType>("linear");

  const filtered = useMemo(() => {
    return sales.filter((s) => {
      // Unrecognized/unreported treatment status passes through rather than
      // being hidden — most of the live feed doesn't report it at all.
      if (s.treatmentStatus && !treatmentStatuses.has(s.treatmentStatus)) return false;
      if (origin !== "all" && s.origin !== origin) return false;
      if (s.weightCarats < caratRange[0] || s.weightCarats > caratRange[1]) return false;
      return true;
    });
  }, [sales, treatmentStatuses, origin, caratRange]);

  const option = useMemo(() => {
    const scatterData: ScatterPointDatum[] = filtered.map((s) => {
      const meta = STATUS_META[s.saleStatus];
      return {
        value: [s.weightCarats, s.priceUsd],
        symbolSize: symbolSizeForCarat(s.weightCarats),
        itemStyle: {
          color: meta.color,
          borderColor: THEME.surfaceRing,
          borderWidth: 1.5,
        },
        sale: s,
      };
    });

    const built: EChartsOption = {
      backgroundColor: "transparent",
      grid: { left: 72, right: 24, top: 24, bottom: 72 },
      xAxis: {
        type: "value",
        name: "Carat Weight",
        nameTextStyle: { color: THEME.mutedInk, align: "left" },
        axisLine: { lineStyle: { color: THEME.axisLine } },
        axisLabel: { color: THEME.mutedInk, formatter: (v: number) => `${v}ct` },
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
        // Hover-to-reveal image + basic info card, per the requested
        // interaction: nothing shows until the pointer is over a datapoint.
        formatter: (params) => {
          const { data } = params as unknown as { data: ScatterPointDatum };
          const s = data.sale;
          const date = s.saleDate
            ? new Date(s.saleDate).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "Date unknown";
          const meta = STATUS_META[s.saleStatus];
          const imageHtml = s.imageUrl
            ? `<img src="${escapeHtml(s.imageUrl)}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;display:block;margin-bottom:8px" />`
            : "";
          return `<div style="min-width:200px">
            ${imageHtml}
            <div style="font-weight:600;font-size:14px;margin-bottom:2px">${formatCurrency(s.priceUsd)}</div>
            <div style="color:${THEME.mutedInk};font-size:12px;margin-bottom:8px">${date} · ${meta.label}</div>
            <div style="font-size:12px;line-height:1.6">
              ${escapeHtml(s.stoneType ?? "Zircon")} · ${s.weightCarats.toFixed(2)}ct<br/>
              ${s.colorCategory ? `${escapeHtml(s.colorCategory)}<br/>` : ""}
              ${s.origin ? `${escapeHtml(s.origin)}<br/>` : ""}
              ${s.treatmentStatus ? (s.treatmentStatus === "unheated" ? "Unheated" : "Heated (Thermal)") + "<br/>" : ""}
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
          <p className="text-lg font-medium text-foreground">Price vs. Carat Weight</p>
          <p className="text-sm text-muted-foreground">
            Sold price · {filtered.length.toLocaleString()} listings
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
    <div className="flex flex-wrap items-center gap-4 border-y border-border/60 py-3">
      <span className="text-xs font-medium text-muted-foreground">Status</span>
      {(Object.entries(STATUS_META) as [SaleStatus, (typeof STATUS_META)[SaleStatus]][]).map(
        ([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, backgroundColor: meta.color }}
            />
            {meta.label}
          </div>
        )
      )}
      <span className="text-xs text-muted-foreground">· Marker size = carat weight</span>
      <span className="text-xs text-muted-foreground">· Hover a point for photo &amp; details</span>
    </div>
  );
}
