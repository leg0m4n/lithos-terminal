import { cache } from "react";
import { supabase } from "@/lib/supabase/client";
import type { TreatmentStatus } from "@/lib/filter-context";

export type SaleStatus = "active" | "sold" | "other";

export interface GemstoneSale {
  sourceUrl: string; // primary key in gemstone_sales
  stoneType: string | null;
  priceUsd: number;
  weightCarats: number;
  colorCategory: string | null;
  origin: string | null;
  treatmentStatus: TreatmentStatus | null; // normalized; null = unreported/unrecognized
  cutQuality: string | null;
  saleDate: string | null; // ISO — most rows don't report one
  saleStatus: SaleStatus;
  imageUrl: string | null;
}

const SELECT_COLUMNS =
  "source_url, stone_type, sold_price_usd, weight_carats, color_category, origin, treatment_status, cut_quality, sale_date, sale_status, image_urls";

interface GemstoneSaleRow {
  source_url: string;
  stone_type: string | null;
  sold_price_usd: number | string | null;
  weight_carats: number | string | null;
  color_category: string | null;
  origin: string | null;
  treatment_status: string | null;
  cut_quality: string | null;
  sale_date: string | null;
  sale_status: string | null;
  image_urls: string[] | null;
}

// The scraper's free-text field has ~8 spellings for "unheated" and a couple
// for "heated" (see ETL source data) — normalize to the sidebar's clean
// enum. Everything else (including the ~90% of rows with no value at all)
// stays null and is treated as "unknown" rather than filtered out.
function normalizeTreatmentStatus(raw: string | null): TreatmentStatus | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (["unheated", "no heat", "untreated", "none (untreated)", "no treatment indicated"].includes(v)) {
    return "unheated";
  }
  if (["heated", "heat treated", "heated (thermal)"].includes(v)) {
    return "heated_thermal";
  }
  return null;
}

function normalizeSaleStatus(raw: string | null): SaleStatus {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "active") return "active";
  if (v === "sold") return "sold";
  return "other";
}

function toGemstoneSale(row: GemstoneSaleRow): GemstoneSale | null {
  const priceUsd = row.sold_price_usd == null ? null : Number(row.sold_price_usd);
  const weightCarats = row.weight_carats == null ? null : Number(row.weight_carats);
  if (priceUsd == null || weightCarats == null || Number.isNaN(priceUsd) || Number.isNaN(weightCarats)) {
    return null;
  }

  return {
    sourceUrl: row.source_url,
    stoneType: row.stone_type,
    priceUsd,
    weightCarats,
    colorCategory: row.color_category || null,
    origin: row.origin || null,
    treatmentStatus: normalizeTreatmentStatus(row.treatment_status),
    cutQuality: row.cut_quality || null,
    saleDate: row.sale_date,
    saleStatus: normalizeSaleStatus(row.sale_status),
    imageUrl: row.image_urls && row.image_urls.length > 0 ? row.image_urls[0] : null,
  };
}

const MARKET_DATA_LIMIT = 500;

// Cached per request so every server component on the page (chart, grid)
// reads the same fetched set instead of re-querying Supabase.
export const getMarketData = cache(async (): Promise<{ sales: GemstoneSale[] }> => {
  const { data, error } = await supabase
    .from("gemstone_sales")
    .select(SELECT_COLUMNS)
    .not("sold_price_usd", "is", null)
    .not("weight_carats", "is", null)
    // Only ~4% of rows report sale_date at all — nullsFirst: false keeps
    // Postgres from sorting the 96% with no date to the front of "recent".
    .order("sale_date", { ascending: false, nullsFirst: false })
    .limit(MARKET_DATA_LIMIT);

  if (error) {
    throw new Error(`Failed to fetch gemstone_sales: ${error.message}`);
  }

  const sales = (data as GemstoneSaleRow[])
    .map(toGemstoneSale)
    .filter((sale): sale is GemstoneSale => sale !== null);

  return { sales };
});

const ORIGIN_OPTIONS_SAMPLE_SIZE = 2000;

// Live replacement for the static ORIGIN_OPTIONS list the sidebar used to
// ship with — sorted by how common each origin actually is in the data.
export const getOriginOptions = cache(async (): Promise<string[]> => {
  const { data, error } = await supabase
    .from("gemstone_sales")
    .select("origin")
    .not("origin", "is", null)
    .neq("origin", "")
    .order("sale_date", { ascending: false, nullsFirst: false })
    .limit(ORIGIN_OPTIONS_SAMPLE_SIZE);

  if (error) {
    throw new Error(`Failed to fetch origin options: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of data as { origin: string }[]) {
    counts.set(row.origin, (counts.get(row.origin) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([origin]) => origin);
});
