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
--
-- ------------------------------------------------------------------
-- PERFORMANCE NOTE — read before adding any predicate to these
-- ------------------------------------------------------------------
-- gemstone_sales rows are dominated by wide JSONB (metadata, image_urls,
-- bid_history). Any query that touches those columns must detoast them for
-- every row, and any query that touches the heap at all reads mostly-useless
-- bytes. An earlier version of these functions filtered junk rows with
--     metadata->>'raw_title' !~ '^[0-9]+\.[0-9]+\s*g\.'
-- which forced exactly that: a 19.6s seq scan per call, over the anon
-- role's statement timeout, so the live dashboard failed to load.
--
-- The fix has three parts, and they matter together:
--   1. gemstone_excluded_lots — the junk-row predicate is evaluated ONCE
--      into a small lookup table, and queries anti-join against it instead
--      of re-running a regex over TOASTed JSONB per row.
--   2. idx_gs_analytics — a covering index over just the narrow analytical
--      columns, so these queries never touch the wide heap at all.
--   3. VACUUM — index-only scans only avoid the heap when the visibility
--      map is current. Before VACUUM: 5,987 heap fetches / 875ms. After: 10
--      fetches / 163ms. Autovacuum normally maintains this, but the table is
--      under continuous scraper writes, so if the dashboard ever gets slow
--      again, check heap fetches in EXPLAIN before assuming a query bug.
--
-- Net effect on the full-table monthly aggregate: 19,663ms -> 163ms.
--
-- KEEP QUERIES OFF metadata/image_urls/bid_history IN THE WHERE CLAUSE.
-- If a new exclusion rule is needed, add it to refresh_excluded_lots()
-- rather than to these functions.

-- ============================================================
-- Excluded lots — rows that are not loose gemstones and would corrupt
-- weight-derived math.
--
-- 'mystery_lot': the site's own blind-buy gimmick listings ("MYSTERY BOX",
--   "MYSTERY EGG", "Red or Blue Pill", "what's behind the door"). The seller
--   hides the contents, so the scraper falls back to a placeholder weight.
--   Detected by TITLE, not weight: an earlier weight_carats = 99 rule caught
--   only 204 of 308 because the placeholders are inconsistent — 99, 98.999,
--   99.999, 100 and 1000 all occur, and a "MYSTERY EGG" at 98.999 sailed
--   through to rank #1 on the most-expensive leaderboard at $1,000,001.
--   Verified no false positives (no listing matches 'mysterious').
--
-- 'finished_jewelry_gram_weight': titles like "2.69g. Natural ... Ring"
--   state TOTAL ITEM weight in grams (metal + stone), and the scraper
--   converts that through gem-weight math into weight_carats — confirmed
--   live: 751 of the first 800 such titles had weight_carats == grams*5
--   exactly, 92% of them landing at >=5ct. A $5 silver ring becomes a fake
--   "15 carat" gemstone, cratering the 5-10ct/10ct+ price buckets. This
--   should ideally be fixed at the dredge-history source (don't parse a
--   jewelry piece's gram weight as carat weight); excluding here is a
--   mitigation, not a real fix.
--
-- NOT self-maintaining: refresh_excluded_lots() must be re-run as the
-- scraper adds rows, or newly-scraped junk silently re-enters the charts.
-- ============================================================

CREATE TABLE IF NOT EXISTS gemstone_excluded_lots (
  source_url text PRIMARY KEY,
  reason text NOT NULL
);

-- NOTE: Postgres uses POSIX regex, where the word boundary is \y — NOT \b
-- (which means backspace and silently matches nothing). A \b version of the
-- parcel probe below returned 0 rows instead of 4,443.
CREATE OR REPLACE FUNCTION refresh_excluded_lots()
RETURNS bigint
LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO gemstone_excluded_lots (source_url, reason)
    SELECT source_url,
           CASE
             WHEN metadata->>'raw_title' ~* '(mystery|red or blue pill|behind the door|lucky dip|surprise (box|bag|lot))'
               THEN 'mystery_lot'
             WHEN metadata->>'raw_title' ~ '^[0-9]+\.[0-9]+\s*g\.'
               THEN 'finished_jewelry_gram_weight'
             ELSE 'placeholder_weight'
           END
    FROM gemstone_sales
    WHERE metadata->>'raw_title' ~* '(mystery|red or blue pill|behind the door|lucky dip|surprise (box|bag|lot))'
       OR metadata->>'raw_title' ~ '^[0-9]+\.[0-9]+\s*g\.'
       OR weight_carats = 99
    ON CONFLICT (source_url) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) FROM ins;
$$;

-- ============================================================
-- Indexes
-- ============================================================

-- The one that matters: covering index over the narrow analytical columns
-- so the dashboard's aggregates run as index-only scans and never read the
-- wide JSONB heap. See the performance note above.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gs_analytics
  ON gemstone_sales (auction_starts)
  INCLUDE (source_url, stone_type, sold_price_usd, weight_carats,
           color_category, origin, is_certified)
  WHERE sale_status = 'Sold';

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
-- CAVEAT on p_color: color_category is a low-confidence scraped label, not
-- verified ground truth. It is exposed as a filter but should not be
-- mistaken for a real variety/quality classification — proper color
-- handling is planned via an ML encoder over listing photos.
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
      date_trunc('month', g.auction_starts) AS month,
      g.sold_price_usd / g.weight_carats AS price_per_carat,
      CASE
        WHEN g.weight_carats < 1 THEN '<1ct'
        WHEN g.weight_carats < 3 THEN '1-3ct'
        WHEN g.weight_carats < 5 THEN '3-5ct'
        WHEN g.weight_carats < 10 THEN '5-10ct'
        ELSE '10ct+'
      END AS weight_tier,
      CASE
        WHEN g.weight_carats < 1 THEN 0
        WHEN g.weight_carats < 3 THEN 1
        WHEN g.weight_carats < 5 THEN 2
        WHEN g.weight_carats < 10 THEN 3
        ELSE 4
      END AS tier_order
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL
      AND g.weight_carats IS NOT NULL AND g.weight_carats > 0
      AND g.auction_starts IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_color IS NULL OR g.color_category = p_color)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
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
-- market_activity — sale counts per time bucket, for the activity chart.
-- p_bucket is clamped rather than interpolated: date_trunc throws on an
-- unknown unit, and an unexpected value shouldn't error the page.
--
-- NOTE for consumers: buckets at the START and END of the returned range
-- are usually PARTIAL, and that is a scrape-coverage artifact rather than
-- real market movement. dredge-history sweeps the site's product-ID space
-- backwards from a start_id that sits ~60 days below the live ceiling, so
-- the newest window is deliberately unswept and the oldest window is
-- wherever the sweep has currently reached. Confirmed live: monthly counts
-- ran ~19-23K/month for Mar-Jun 2026, then 11K for Jul and 21 for Aug —
-- the July/August collapse is the unswept buffer, not a market crash.
-- The chart component detects and visually marks these edges.
-- ============================================================

CREATE OR REPLACE FUNCTION market_activity(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false,
  p_bucket text DEFAULT 'month'
)
RETURNS TABLE (bucket timestamptz, sale_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc(
      CASE WHEN p_bucket IN ('day', 'week', 'month') THEN p_bucket ELSE 'month' END,
      g.auction_starts
    ) AS bucket,
    count(*) AS sale_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.auction_starts IS NOT NULL
    AND g.sold_price_usd IS NOT NULL
    AND g.weight_carats IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
    AND (p_origin IS NULL OR g.origin = p_origin)
    AND (p_color IS NULL OR g.color_category = p_color)
    AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR g.is_certified = true)
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION market_activity(text,text,text,numeric,numeric,numeric,numeric,boolean,text) TO anon;

-- ============================================================
-- top_price_outliers — "most expensive sales" leaderboard.
--
-- Two-phase on purpose. The selected columns include image_urls (wide
-- JSONB), so selecting them before the LIMIT would make Postgres detoast
-- every matching row just to throw all but p_limit away — that alone pushed
-- this over the statement timeout. The inner query stays narrow enough to
-- run as an index-only scan against idx_gs_analytics; only the surviving
-- p_limit rows are joined back to the heap for their full payload.
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
  WITH top AS (
    SELECT g.source_url
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL
      AND g.weight_carats IS NOT NULL
      AND g.auction_starts IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_color IS NULL OR g.color_category = p_color)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
    ORDER BY g.sold_price_usd DESC
    LIMIT p_limit
  )
  SELECT
    g.source_url, g.stone_type, g.sold_price_usd, g.weight_carats, g.color_category,
    g.origin, g.treatment_status, g.shape, g.cut_style, g.clarity, g.is_certified,
    g.certification_lab, g.auction_starts, g.image_urls
  FROM top t
  JOIN gemstone_sales g ON g.source_url = t.source_url
  ORDER BY g.sold_price_usd DESC;
$$;

GRANT EXECUTE ON FUNCTION top_price_outliers(text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

-- ============================================================
-- sales_page — server-side pagination for the listings grid.
--
-- Same two-phase shape as top_price_outliers, for a sharper version of the
-- same problem: `count(*) OVER()` cannot be computed without materialising
-- the entire filtered result set, so pairing it with a wide SELECT list made
-- every page request detoast image_urls for all ~96K matching rows to return
-- 50. Here the narrow CTE does both jobs from the covering index — it is
-- counted for total_count and sliced for the page — and only the 50 rows on
-- the page are joined back for their full payload.
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
  WITH filtered AS (
    SELECT g.source_url, g.auction_starts
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL
      AND g.weight_carats IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_color IS NULL OR g.color_category = p_color)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
  ),
  total AS (SELECT count(*) AS c FROM filtered),
  page AS (
    SELECT source_url FROM filtered
    ORDER BY auction_starts DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    g.source_url, g.stone_type, g.sold_price_usd, g.weight_carats, g.color_category,
    g.origin, g.treatment_status, g.shape, g.cut_style, g.clarity, g.is_certified,
    g.certification_lab, g.auction_starts, g.image_urls,
    t.c AS total_count
  FROM page p
  JOIN gemstone_sales g ON g.source_url = p.source_url
  CROSS JOIN total t
  ORDER BY g.auction_starts DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION sales_page(text,text,text,numeric,numeric,numeric,numeric,boolean,int,int) TO anon;

-- ============================================================
-- stone_type_counts / origin_counts_for_type / color_counts_for_type — power
-- the left-nav stone type switcher and the Origin/Color dropdowns (each
-- scoped to the selected stone type). All apply the same exclusions as the
-- charts so the nav counts tie out with what the charts actually plot.
-- ============================================================

CREATE OR REPLACE FUNCTION stone_type_counts()
RETURNS TABLE (stone_type text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(g.stone_type, 'Unclassified') AS stone_type, count(*) AS txn_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.sold_price_usd IS NOT NULL
    AND g.weight_carats IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION stone_type_counts() TO anon;

CREATE OR REPLACE FUNCTION origin_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (origin text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT g.origin, count(*) AS txn_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.origin IS NOT NULL AND g.origin != ''
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION origin_counts_for_type(text) TO anon;

CREATE OR REPLACE FUNCTION color_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (color_category text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT g.color_category, count(*) AS txn_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.color_category IS NOT NULL AND g.color_category != ''
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION color_counts_for_type(text) TO anon;

NOTIFY pgrst, 'reload schema';
