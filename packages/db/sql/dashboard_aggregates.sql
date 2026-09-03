-- Applied directly against the Supabase project via psql — there is no
-- migration tool wired to gemstone_sales (it's owned/written by the
-- lithos-dredge scrapers, not this repo's drizzle schema in packages/db/src).
-- This file exists purely so the RPCs backing the dashboard are reviewable
-- and reproducible; re-running it is safe (CREATE OR REPLACE / IF NOT EXISTS
-- throughout, DROP FUNCTION IF EXISTS before signature changes).
--
-- Why these exist: the dashboard used to fetch every sold row and filter in
-- the browser. That doesn't scale — the dataset is headed toward ~1.6M rows.
-- These push aggregation, top-N ranking, and pagination into Postgres so
-- response size stays bounded regardless of table size. See
-- apps/web/lib/market-data.ts for the client-side callers.

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_auction_starts
  ON gemstone_sales (auction_starts);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_stonetype_auctionstarts
  ON gemstone_sales (stone_type, auction_starts)
  WHERE sale_status = 'Sold';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_stonetype_price
  ON gemstone_sales (stone_type, sold_price_usd DESC)
  WHERE sale_status = 'Sold';

-- ============================================================
-- historic_price_trend — powers the trend chart.
--
-- Weight-tier edges match CARAT_BRACKET_STOPS in
-- apps/web/lib/filter-context.tsx (0, 1, 3, 5, 10, 16) — keep in sync if
-- that constant ever changes.
--
-- Price-per-carat is computed PER SALE first, then median'd within each
-- (month, tier) bucket — never total-dollars-over-total-carats, which would
-- let a month with more big stones in a bucket quietly skew the number.
--
-- weight_carats = 99 is excluded: it's the scraper's fallback when a seller
-- deliberately hides weight (the site's own "mystery item"/"mystery egg"
-- gimmick listings — "red or blue pill", "what's behind the door"), not a
-- real measurement. Confirmed live: 62 rows, all of that pattern. Left in,
-- it silently poisons the 10ct+ bucket's median with a fake denominator.
--
-- p_color exists because "stone_type alone" isn't apples-to-apples: a single
-- species like Garnet blends wildly different-value varieties (Demantoid/
-- Tsavorite at $29-68/carat vs. common Red/Orange/Pink garnet at $3-14/carat)
-- whose mix shifts by size (green is ~59% of the <1ct tier, ~9% of 10ct+) —
-- confirmed live. Without a color filter, that composition shift alone
-- produces a spurious "smaller stones cost more per carat" pattern in the
-- blended trend that has nothing to do with actual size-based pricing.
-- ============================================================

DROP FUNCTION IF EXISTS historic_price_trend(text,text,numeric,numeric,numeric,numeric,boolean);

CREATE OR REPLACE FUNCTION historic_price_trend(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false
)
RETURNS TABLE (
  month timestamptz,
  weight_tier text,
  tier_order int,
  median_price_per_carat numeric,
  txn_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT
      date_trunc('month', auction_starts) AS month,
      sold_price_usd / weight_carats AS price_per_carat,
      CASE
        WHEN weight_carats < 1 THEN '<1ct'
        WHEN weight_carats < 3 THEN '1-3ct'
        WHEN weight_carats < 5 THEN '3-5ct'
        WHEN weight_carats < 10 THEN '5-10ct'
        ELSE '10ct+'
      END AS weight_tier,
      CASE
        WHEN weight_carats < 1 THEN 0
        WHEN weight_carats < 3 THEN 1
        WHEN weight_carats < 5 THEN 2
        WHEN weight_carats < 10 THEN 3
        ELSE 4
      END AS tier_order
    FROM gemstone_sales
    WHERE sale_status = 'Sold'
      AND sold_price_usd IS NOT NULL
      AND weight_carats IS NOT NULL AND weight_carats > 0
      AND weight_carats != 99
      AND auction_starts IS NOT NULL
      AND (p_stone_type IS NULL OR stone_type = p_stone_type)
      AND (p_origin IS NULL OR origin = p_origin)
      AND (p_color IS NULL OR color_category = p_color)
      AND (p_min_carat IS NULL OR weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR is_certified = true)
  )
  SELECT
    month, weight_tier, tier_order,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_carat) AS median_price_per_carat,
    count(*) AS txn_count
  FROM filtered
  GROUP BY month, weight_tier, tier_order
  ORDER BY month, tier_order;
$$;

GRANT EXECUTE ON FUNCTION historic_price_trend(text,text,text,numeric,numeric,numeric,numeric,boolean) TO anon;

-- ============================================================
-- top_price_outliers — "most expensive sales" leaderboard.
-- Bounded top-N (ORDER BY price DESC LIMIT n), index-assisted — finding the
-- top 20 out of 1.6M rows isn't meaningfully more expensive than out of 40K.
-- ============================================================

DROP FUNCTION IF EXISTS top_price_outliers(text,text,numeric,numeric,numeric,numeric,boolean,int);

CREATE OR REPLACE FUNCTION top_price_outliers(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  source_url text, stone_type text, sold_price_usd numeric, weight_carats numeric,
  color_category text, origin text, treatment_status text, shape text, cut_style text,
  clarity text, is_certified boolean, certification_lab text, auction_starts timestamptz,
  image_urls jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT
    source_url, stone_type, sold_price_usd, weight_carats, color_category, origin,
    treatment_status, shape, cut_style, clarity, is_certified, certification_lab,
    auction_starts, image_urls
  FROM gemstone_sales
  WHERE sale_status = 'Sold'
    AND sold_price_usd IS NOT NULL
    AND weight_carats IS NOT NULL
    AND weight_carats != 99 -- see historic_price_trend: scraper's "hidden weight" placeholder
    AND auction_starts IS NOT NULL
    AND (p_stone_type IS NULL OR stone_type = p_stone_type)
    AND (p_origin IS NULL OR origin = p_origin)
    AND (p_color IS NULL OR color_category = p_color)
    AND (p_min_carat IS NULL OR weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR is_certified = true)
  ORDER BY sold_price_usd DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION top_price_outliers(text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

-- ============================================================
-- sales_page — server-side pagination for the listings grid.
-- total_count comes back via a window function on the same query, no
-- second round trip for "page X of Y".
-- ============================================================

DROP FUNCTION IF EXISTS sales_page(text,text,numeric,numeric,numeric,numeric,boolean,int,int);

CREATE OR REPLACE FUNCTION sales_page(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  source_url text, stone_type text, sold_price_usd numeric, weight_carats numeric,
  color_category text, origin text, treatment_status text, shape text, cut_style text,
  clarity text, is_certified boolean, certification_lab text, auction_starts timestamptz,
  image_urls jsonb, total_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    source_url, stone_type, sold_price_usd, weight_carats, color_category, origin,
    treatment_status, shape, cut_style, clarity, is_certified, certification_lab,
    auction_starts, image_urls,
    count(*) OVER() AS total_count
  FROM gemstone_sales
  WHERE sale_status = 'Sold'
    AND sold_price_usd IS NOT NULL
    AND weight_carats IS NOT NULL
    AND weight_carats != 99 -- see historic_price_trend: scraper's "hidden weight" placeholder
    AND (p_stone_type IS NULL OR stone_type = p_stone_type)
    AND (p_origin IS NULL OR origin = p_origin)
    AND (p_color IS NULL OR color_category = p_color)
    AND (p_min_carat IS NULL OR weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR is_certified = true)
  ORDER BY auction_starts DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION sales_page(text,text,text,numeric,numeric,numeric,numeric,boolean,int,int) TO anon;

-- ============================================================
-- stone_type_counts / origin_counts_for_type / color_counts_for_type — power
-- the left-nav stone type switcher and the Origin/Color dropdowns (each
-- scoped to the selected stone type).
-- ============================================================

CREATE OR REPLACE FUNCTION stone_type_counts()
RETURNS TABLE (stone_type text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(stone_type, 'Unclassified') AS stone_type, count(*) AS txn_count
  FROM gemstone_sales
  WHERE sale_status = 'Sold'
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION stone_type_counts() TO anon;

CREATE OR REPLACE FUNCTION origin_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (origin text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT origin, count(*) AS txn_count
  FROM gemstone_sales
  WHERE sale_status = 'Sold'
    AND origin IS NOT NULL AND origin != ''
    AND (p_stone_type IS NULL OR stone_type = p_stone_type)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION origin_counts_for_type(text) TO anon;

CREATE OR REPLACE FUNCTION color_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (color_category text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT color_category, count(*) AS txn_count
  FROM gemstone_sales
  WHERE sale_status = 'Sold'
    AND color_category IS NOT NULL AND color_category != ''
    AND (p_stone_type IS NULL OR stone_type = p_stone_type)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION color_counts_for_type(text) TO anon;

NOTIFY pgrst, 'reload schema';
