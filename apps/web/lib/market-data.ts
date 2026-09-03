import { supabase } from "@/lib/supabase/client";
import { CARAT_MAX, PRICE_MAX, type TreatmentStatus } from "@/lib/filter-context";

// dredge-history only ever writes sale_status = 'Sold' (reserve_not_met is
// already filtered out at write time — see HANDOFF_LITHOS_TERMINAL.md).
export type SaleStatus = "sold";

// A single sold listing — the shape returned by top_price_outliers and
// sales_page. No longer the shape of "the whole table"; there is no
// function in this file that fetches every row anymore (see README note
// below on why: at 1.6M+ rows that model doesn't work).
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
  // "When this specific auction began" — a real per-listing timestamp, but
  // NOT a confirmed sale date (GemRockAuctions doesn't expose one). Chosen
  // over price_valid_until, which is the scheduled *close* time and clusters
  // by auction-cycle scheduling rather than spreading across real history.
  auctionStartsAt: string | null;
  saleStatus: SaleStatus;
  imageUrl: string | null; // image_urls[0] only — the R2-archived, permanent copy
}

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
  auction_starts: string | null;
  image_urls: string[] | null;
}

// The scraper's free-text field has ~8 spellings for "unheated" and a couple
// for "heated" — normalize to the sidebar's clean enum. Everything else
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
    auctionStartsAt: row.auction_starts,
    saleStatus: "sold",
    // image_urls[1:] are un-archived pointers back to the source site's own
    // CDN and rot — only index 0 is the permanent R2-hosted copy.
    imageUrl: row.image_urls && row.image_urls.length > 0 ? row.image_urls[0] : null,
  };
}

export interface SaleFilters {
  stoneType: string; // "all" | specific stone_type value
  origin: string; // "all" | specific origin name
  caratRange: [number, number];
  priceRange: [number, number];
  certifiedOnly: boolean;
}

// Every RPC below takes the same filter shape. A range pinned to its slider
// max (CARAT_MAX/PRICE_MAX) becomes NULL ("no upper bound") rather than a
// literal number — see the historic carat-slider bug: comparing against a
// hard ceiling silently drops real stones above it even when the UI implies
// "no limit" via its "+" label.
function toRpcParams(filters: SaleFilters) {
  return {
    p_stone_type: filters.stoneType === "all" ? null : filters.stoneType,
    p_origin: filters.origin === "all" ? null : filters.origin,
    p_min_carat: filters.caratRange[0] > 0 ? filters.caratRange[0] : null,
    p_max_carat: filters.caratRange[1] < CARAT_MAX ? filters.caratRange[1] : null,
    p_min_price: filters.priceRange[0] > 0 ? filters.priceRange[0] : null,
    p_max_price: filters.priceRange[1] < PRICE_MAX ? filters.priceRange[1] : null,
    p_certified_only: filters.certifiedOnly,
  };
}

export interface TrendPoint {
  month: string; // ISO, first-of-month
  weightTier: string; // "<1ct" | "1-3ct" | "3-5ct" | "5-10ct" | "10ct+"
  tierOrder: number; // 0-4, for stable legend/series ordering
  medianPricePerCarat: number;
  txnCount: number;
}

interface TrendPointRow {
  month: string;
  weight_tier: string;
  tier_order: number;
  median_price_per_carat: number | string;
  txn_count: number;
}

// The core scaling fix: this asks Postgres for a GROUP BY (month x weight
// tier), not raw rows. Response size is bounded by time span x tier count
// (tens to low hundreds of rows) regardless of whether the table holds 40K
// sales or 1.6M — chart load time stops depending on table size.
export async function getHistoricPriceTrend(filters: SaleFilters): Promise<TrendPoint[]> {
  const { data, error } = await supabase.rpc("historic_price_trend", toRpcParams(filters));
  if (error) throw new Error(`historic_price_trend failed: ${error.message}`);

  return (data as TrendPointRow[]).map((row) => ({
    month: row.month,
    weightTier: row.weight_tier,
    tierOrder: row.tier_order,
    medianPricePerCarat: Number(row.median_price_per_carat),
    txnCount: row.txn_count,
  }));
}

const OUTLIER_LIMIT = 20;

// "Most expensive sales" is a bounded top-N query (ORDER BY price DESC
// LIMIT N, index-assisted) — finding the top 20 out of 1.6M rows isn't
// meaningfully more expensive than finding it out of 40K.
export async function getTopPriceOutliers(filters: SaleFilters): Promise<GemstoneSale[]> {
  const { data, error } = await supabase.rpc("top_price_outliers", {
    ...toRpcParams(filters),
    p_limit: OUTLIER_LIMIT,
  });
  if (error) throw new Error(`top_price_outliers failed: ${error.message}`);

  return (data as GemstoneSaleRow[])
    .map(toGemstoneSale)
    .filter((sale): sale is GemstoneSale => sale !== null);
}

export const GRID_PAGE_SIZE = 50;

export interface SalesPageResult {
  rows: GemstoneSale[];
  totalCount: number;
}

// Real server-side pagination for the listings grid — fetches only the
// current page (LIMIT/OFFSET) instead of pulling everything and slicing in
// the browser. total_count comes back via a window function on the same
// query, no second round trip.
export async function getSalesPage(filters: SaleFilters, page: number): Promise<SalesPageResult> {
  const { data, error } = await supabase.rpc("sales_page", {
    ...toRpcParams(filters),
    p_limit: GRID_PAGE_SIZE,
    p_offset: page * GRID_PAGE_SIZE,
  });
  if (error) throw new Error(`sales_page failed: ${error.message}`);

  const rows = data as (GemstoneSaleRow & { total_count: number })[];
  const totalCount = rows[0]?.total_count ?? 0;
  const sales = rows.map(toGemstoneSale).filter((sale): sale is GemstoneSale => sale !== null);

  return { rows: sales, totalCount };
}

export interface StoneTypeOption {
  value: string;
  label: string;
  count: number;
}

const UNCLASSIFIED_LABEL = "Unclassified";

interface StoneTypeCountRow {
  stone_type: string;
  txn_count: number;
}

// Powers the left-nav stone-type switcher — a single SQL GROUP BY instead of
// paging the whole stone_type column into JS and counting client-side.
export async function getStoneTypeOptions(): Promise<StoneTypeOption[]> {
  const { data, error } = await supabase.rpc("stone_type_counts");
  if (error) throw new Error(`stone_type_counts failed: ${error.message}`);

  return (data as StoneTypeCountRow[])
    .map((row) => ({ value: row.stone_type, label: row.stone_type, count: row.txn_count }))
    .sort((a, b) => {
      // Unclassified always sinks to the bottom regardless of count — it's
      // a fallback bucket, not a real category to switch into.
      if (a.value === UNCLASSIFIED_LABEL) return 1;
      if (b.value === UNCLASSIFIED_LABEL) return -1;
      return b.count - a.count;
    });
}

interface OriginCountRow {
  origin: string;
  txn_count: number;
}

// Origins scoped to the selected stone type (a Sapphire buyer shouldn't see
// Tanzanite-only origins) — a live scoped GROUP BY, not a derivation from a
// full client-side dataset that no longer exists.
export async function getOriginOptionsForType(stoneType: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("origin_counts_for_type", {
    p_stone_type: stoneType === "all" ? null : stoneType,
  });
  if (error) throw new Error(`origin_counts_for_type failed: ${error.message}`);

  return (data as OriginCountRow[]).map((row) => row.origin);
}
