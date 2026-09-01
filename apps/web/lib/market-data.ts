import { cache } from "react";
import { supabase } from "@/lib/supabase/client";
import type { TreatmentStatus } from "@/lib/filter-context";

// dredge-history only ever writes sale_status = 'Sold' (reserve_not_met is
// already filtered out at write time — see HANDOFF_LITHOS_TERMINAL.md). The
// literal type stays open for when dredge-live starts writing 'Active' rows.
export type SaleStatus = "sold" | "active" | "other";

export interface GemstoneSale {
  sourceUrl: string; // primary key in gemstone_sales
  stoneType: string | null;
  priceUsd: number;
  weightCarats: number;
  colorCategory: string | null;
  origin: string | null;
  treatmentStatus: TreatmentStatus | null; // normalized; null = unreported/unrecognized
  shape: string | null; // geometric shape (Oval, Cushion...), not a quality grade
  cutStyle: string | null; // "Faceted" / "Cabochon"
  clarity: string | null;
  isCertified: boolean | null;
  certificationLab: string | null;
  bidCount: number | null;
  startingBidUsd: number | null;
  // "When this specific auction began" — a real per-listing timestamp, but
  // NOT a confirmed sale date (GemRockAuctions doesn't expose one). Chosen
  // over price_valid_until, which is the scheduled *close* time and clusters
  // by auction-cycle scheduling rather than spreading across real history.
  auctionStartsAt: string | null;
  saleStatus: SaleStatus;
  imageUrl: string | null; // image_urls[0] only — the R2-archived, permanent copy
}

const SELECT_COLUMNS =
  "source_url, stone_type, sold_price_usd, weight_carats, color_category, origin, treatment_status, shape, cut_style, clarity, is_certified, certification_lab, bid_count, starting_bid_usd, auction_starts, image_urls, sale_status";

interface GemstoneSaleRow {
  source_url: string;
  stone_type: string | null;
  sold_price_usd: number | string | null;
  weight_carats: number | string | null;
  color_category: string | null;
  origin: string | null;
  treatment_status: string | null;
  shape: string | null;
  cut_style: string | null;
  clarity: string | null;
  is_certified: boolean | null;
  certification_lab: string | null;
  bid_count: number | null;
  starting_bid_usd: number | string | null;
  auction_starts: string | null;
  image_urls: string[] | null;
  sale_status: string | null;
}

// The scraper's free-text field has ~8 spellings for "unheated" and a couple
// for "heated" (see ETL source data) — normalize to the sidebar's clean
// enum. Everything else (including the majority of rows with no value at
// all) stays null and is treated as "unknown" rather than filtered out.
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
  if (v === "sold") return "sold";
  if (v === "active") return "active";
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
    shape: row.shape || null,
    cutStyle: row.cut_style || null,
    clarity: row.clarity || null,
    isCertified: row.is_certified,
    certificationLab: row.certification_lab || null,
    bidCount: row.bid_count,
    startingBidUsd: row.starting_bid_usd == null ? null : Number(row.starting_bid_usd),
    auctionStartsAt: row.auction_starts,
    saleStatus: normalizeSaleStatus(row.sale_status),
    // image_urls[1:] are un-archived pointers back to the source site's own
    // CDN and rot — only index 0 is the permanent R2-hosted copy.
    imageUrl: row.image_urls && row.image_urls.length > 0 ? row.image_urls[0] : null,
  };
}

const MARKET_DATA_LIMIT = 5000;

// Cached per request so every server component on the page (chart, grid)
// reads the same fetched set instead of re-querying Supabase.
export const getMarketData = cache(async (): Promise<{ sales: GemstoneSale[] }> => {
  const { data, error } = await supabase
    .from("gemstone_sales")
    .select(SELECT_COLUMNS)
    // dredge-history's write gate already excludes reserve_not_met rows, so
    // no need to re-filter for that here — see HANDOFF_LITHOS_TERMINAL.md.
    .eq("sale_status", "Sold")
    .not("sold_price_usd", "is", null)
    .not("weight_carats", "is", null)
    .order("auction_starts", { ascending: false, nullsFirst: false })
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
    .eq("sale_status", "Sold")
    .not("origin", "is", null)
    .neq("origin", "")
    .order("auction_starts", { ascending: false, nullsFirst: false })
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

export interface SaleFilters {
  stoneType: string;
  treatmentStatuses: Set<TreatmentStatus>;
  origin: string;
  caratRange: [number, number];
}

// Shared by the chart and the grid so "switch stone type" filters both
// consistently instead of the grid silently ignoring the left-nav.
export function filterSales(sales: GemstoneSale[], filters: SaleFilters): GemstoneSale[] {
  return sales.filter((s) => {
    if (filters.stoneType !== "all" && s.stoneType !== filters.stoneType) return false;
    // Unrecognized/unreported treatment status passes through rather than
    // being hidden — most of the feed doesn't report it at all.
    if (s.treatmentStatus && !filters.treatmentStatuses.has(s.treatmentStatus)) return false;
    if (filters.origin !== "all" && s.origin !== filters.origin) return false;
    if (s.weightCarats < filters.caratRange[0] || s.weightCarats > filters.caratRange[1]) return false;
    return true;
  });
}

export interface StoneTypeOption {
  value: string;
  label: string;
  count: number;
}

const UNCLASSIFIED_LABEL = "Unclassified";

// Powers the left-nav stone-type switcher. Counts are exact (a plain
// aggregate query), not sampled — this table is small enough for now that a
// full scan per stone_type is cheap, unlike the origin sample above.
export const getStoneTypeOptions = cache(async (): Promise<StoneTypeOption[]> => {
  const { data, error } = await supabase
    .from("gemstone_sales")
    .select("stone_type")
    .eq("sale_status", "Sold");

  if (error) {
    throw new Error(`Failed to fetch stone types: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of data as { stone_type: string | null }[]) {
    const key = row.stone_type || UNCLASSIFIED_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const options = [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => {
      // Unclassified always sinks to the bottom regardless of count — it's
      // a fallback bucket, not a real category to switch into.
      if (a.value === UNCLASSIFIED_LABEL) return 1;
      if (b.value === UNCLASSIFIED_LABEL) return -1;
      return b.count - a.count;
    });

  return options;
});
