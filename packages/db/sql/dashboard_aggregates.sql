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
-- 'multi_stone_parcel': wholesale melee/parcel listings — "1.50 mm Round 50
--   pcs Sapphire, 1.00ct total, $17", "LOT Of Natural Pink Kunzite Gems",
--   "(3 Stones)". weight_carats is the TOTAL across many stones, so $/carat
--   describes a parcel's bulk economics and isn't comparable to a single
--   stone of the same total weight. ~4,670 rows (~4.5% of sold).
--   The piece-count pattern deliberately requires a count of 2 or more:
--   "1 pcs" / "1 piece" listings are single stones and must stay in.
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
-- parcel pattern returned 0 rows instead of 4,670.
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
             WHEN metadata->>'raw_title' ~* '(([2-9]|[1-9][0-9]+)\s*(pc|pcs|piece|pieces|stone|stones)\y|\ylot of\y|\yparcel\y)'
               THEN 'multi_stone_parcel'
             ELSE 'placeholder_weight'
           END
    FROM gemstone_sales
    WHERE metadata->>'raw_title' ~* '(mystery|red or blue pill|behind the door|lucky dip|surprise (box|bag|lot))'
       OR metadata->>'raw_title' ~ '^[0-9]+\.[0-9]+\s*g\.'
       OR metadata->>'raw_title' ~* '(([2-9]|[1-9][0-9]+)\s*(pc|pcs|piece|pieces|stone|stones)\y|\ylot of\y|\yparcel\y)'
       OR weight_carats = 99
    ON CONFLICT (source_url) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) FROM ins;
$$;

-- ============================================================
-- gemstone_search — narrow (source_url, title) mirror, purely so text
-- search never touches the wide JSONB.
--
-- raw_title lives inside metadata, so searching it directly means detoasting
-- a large blob per candidate row. Measured: a naive ILIKE over
-- metadata->>'raw_title' was 16.3s. Adding a GIN trigram index straight onto
-- that expression fixed *narrow* terms (0.4s) but NOT broad ones — 'blue'
-- matches 13k rows and the index recheck detoasted every one, still 14s.
-- Mirroring the title into this narrow table drops the same query to 0.39s,
-- because the recheck reads a skinny row instead of a JSONB blob.
--
-- Like gemstone_excluded_lots this is NOT self-maintaining:
-- refresh_search_index() must be re-run as the scraper adds rows, or new
-- listings simply won't be findable by text search.
-- ============================================================

CREATE TABLE IF NOT EXISTS gemstone_search (
  source_url text PRIMARY KEY,
  title text NOT NULL
);

CREATE OR REPLACE FUNCTION refresh_search_index()
RETURNS bigint LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO gemstone_search (source_url, title)
    SELECT source_url, metadata->>'raw_title'
    FROM gemstone_sales
    WHERE metadata->>'raw_title' IS NOT NULL
    ON CONFLICT (source_url) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) FROM ins;
$$;

-- ============================================================
-- Indexes
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The one that matters for aggregates: covering index over the narrow
-- analytical columns so the dashboard never reads the wide JSONB heap.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gs_analytics
  ON gemstone_sales (auction_starts)
  INCLUDE (source_url, stone_type, sold_price_usd, weight_carats,
           color_category, origin, is_certified, treatment_status)
  WHERE sale_status = 'Sold';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_search_title_trgm
  ON gemstone_search USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_auction_starts
  ON gemstone_sales (auction_starts);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_stonetype_auctionstarts
  ON gemstone_sales (stone_type, auction_starts)
  WHERE sale_status = 'Sold';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_sales_stonetype_price
  ON gemstone_sales (stone_type, sold_price_usd DESC)
  WHERE sale_status = 'Sold';

-- ============================================================
-- SHARED FILTER CONTRACT
--
-- Every function below takes the same filter set, in the same order:
--   p_stone_type, p_origin, p_treatment, p_search,
--   p_min_carat, p_max_carat, p_min_price, p_max_price, p_certified_only
--
-- Search is always expressed as a `hits` CTE plus an EXISTS, never as
-- `(p_search IS NULL OR title ILIKE ...)` inline. That is not stylistic: a
-- top-level OR against a *parameter* forces a generic plan that can neither
-- use the trigram index nor fold the predicate away, which measured 17s.
-- The CTE form is 0.24-0.5s whether or not a search is active.
--
-- NO COLOR PARAMETER, deliberately. color_category is a keyword-guessed
-- label, not verified ground truth, so filtering on it produced false
-- precision. Colour stays untouched until it can be derived properly from
-- high-res images via a VLM/encoder. Do not re-add a filter off that column.
--
-- CAVEAT on p_treatment: treatment_status is ~98% populated but 78% of rows
-- say "No Treatment", which in gem listings is usually an unstated default
-- rather than an independently verified claim. Fine for narrowing comps;
-- do not present it as proof a stone is untreated.
-- ============================================================

-- ============================================================
-- historic_price_trend — median $/carat per (month x weight tier).
-- Weight-tier edges match CARAT_BRACKET_STOPS in filter-context.tsx.
-- Price-per-carat is computed PER SALE then median'd — never
-- total-dollars-over-total-carats.
-- ============================================================

DROP FUNCTION IF EXISTS historic_price_trend(text,text,numeric,numeric,numeric,numeric,boolean);
DROP FUNCTION IF EXISTS historic_price_trend(text,text,text,numeric,numeric,numeric,numeric,boolean);

CREATE OR REPLACE FUNCTION historic_price_trend(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false
)
RETURNS TABLE (
  month timestamptz, weight_tier text, tier_order int,
  median_price_per_carat numeric, txn_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  ),
  filtered AS (
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
      AND (p_treatment IS NULL OR g.treatment_status = p_treatment)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
      AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
  )
  SELECT month, weight_tier, tier_order,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_carat) AS median_price_per_carat,
    count(*) AS txn_count
  FROM filtered
  GROUP BY month, weight_tier, tier_order
  ORDER BY month, tier_order;
$$;

GRANT EXECUTE ON FUNCTION historic_price_trend(text,text,text,text,numeric,numeric,numeric,numeric,boolean) TO anon;

-- ============================================================
-- market_activity — sale counts per time bucket.
-- p_bucket is clamped rather than interpolated: date_trunc throws on an
-- unknown unit, and an unexpected value shouldn't error the page.
--
-- NOTE for consumers: buckets at the START and END of the range are usually
-- PARTIAL — a scrape-coverage artifact, not real market movement.
-- dredge-history sweeps backwards from a start_id ~60 days below the live
-- ceiling. The chart component detects and greys those edges.
-- ============================================================

DROP FUNCTION IF EXISTS market_activity(text,text,numeric,numeric,numeric,numeric,boolean,text);
DROP FUNCTION IF EXISTS market_activity(text,text,text,numeric,numeric,numeric,numeric,boolean,text);

CREATE OR REPLACE FUNCTION market_activity(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false,
  p_bucket text DEFAULT 'month'
)
RETURNS TABLE (bucket timestamptz, sale_count bigint)
LANGUAGE sql STABLE AS $$
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  )
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
    AND (p_treatment IS NULL OR g.treatment_status = p_treatment)
    AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR g.is_certified = true)
    AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION market_activity(text,text,text,text,numeric,numeric,numeric,numeric,boolean,text) TO anon;

-- ============================================================
-- price_distribution — the comps panel: how much did matching stones
-- actually sell for?
--
-- Bins are equal-width in LOG space, because sold prices span ~$2 to
-- ~$75,000 and linear bins would pile ~everything into bin 1. Empty bins are
-- emitted too (via generate_series) so the histogram stays continuous rather
-- than silently collapsing gaps.
--
-- Summary stats (n / p25 / median / p75 / min / max / median $ per carat) are
-- repeated on every row so the whole panel is one round trip.
-- ============================================================

CREATE OR REPLACE FUNCTION price_distribution(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL,
  p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false,
  p_bins int DEFAULT 24
)
RETURNS TABLE (
  bin_index int, bin_low numeric, bin_high numeric, sale_count bigint,
  total_count bigint, p25 numeric, p50 numeric, p75 numeric,
  min_price numeric, max_price numeric, median_price_per_carat numeric
)
LANGUAGE sql STABLE AS $$
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  ),
  filtered AS (
    SELECT g.sold_price_usd AS price, g.sold_price_usd / g.weight_carats AS ppc
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL AND g.sold_price_usd > 0
      AND g.weight_carats IS NOT NULL AND g.weight_carats > 0
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_treatment IS NULL OR g.treatment_status = p_treatment)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
      AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
  ),
  stats AS (
    SELECT count(*) AS n, min(price) AS mn, max(price) AS mx,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS q25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY price) AS q50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS q75,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY ppc) AS mppc
    FROM filtered
  ),
  binned AS (
    SELECT least(
             width_bucket(ln(f.price::double precision),
                          ln(s.mn::double precision),
                          ln(s.mx::double precision), p_bins),
             p_bins) AS bi,
           count(*) AS c
    FROM filtered f CROSS JOIN stats s
    WHERE s.mx > s.mn
    GROUP BY 1
  )
  SELECT
    i AS bin_index,
    round(exp(ln(s.mn::double precision) + (i - 1) * (ln(s.mx::double precision) - ln(s.mn::double precision)) / p_bins)::numeric, 2) AS bin_low,
    round(exp(ln(s.mn::double precision) + i * (ln(s.mx::double precision) - ln(s.mn::double precision)) / p_bins)::numeric, 2) AS bin_high,
    coalesce(b.c, 0) AS sale_count,
    s.n AS total_count, s.q25 AS p25, s.q50 AS p50, s.q75 AS p75,
    s.mn AS min_price, s.mx AS max_price, s.mppc AS median_price_per_carat
  FROM generate_series(1, p_bins) AS i
  CROSS JOIN stats s
  LEFT JOIN binned b ON b.bi = i
  WHERE s.n > 0 AND s.mx > s.mn
  ORDER BY i;
$$;

GRANT EXECUTE ON FUNCTION price_distribution(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

-- ============================================================
-- top_price_outliers — "most expensive sales" leaderboard.
--
-- Two-phase on purpose. The selected columns include image_urls (wide
-- JSONB), so selecting them before the LIMIT would make Postgres detoast
-- every matching row just to throw all but p_limit away.
-- ============================================================

DROP FUNCTION IF EXISTS top_price_outliers(text,text,numeric,numeric,numeric,numeric,boolean,int);
DROP FUNCTION IF EXISTS top_price_outliers(text,text,text,numeric,numeric,numeric,numeric,boolean,int);

CREATE OR REPLACE FUNCTION top_price_outliers(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL,
  p_search text DEFAULT NULL,
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
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  ),
  top AS (
    SELECT g.source_url
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL
      AND g.weight_carats IS NOT NULL
      AND g.auction_starts IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_treatment IS NULL OR g.treatment_status = p_treatment)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
      AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
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

GRANT EXECUTE ON FUNCTION top_price_outliers(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

-- ============================================================
-- sales_page — server-side pagination for the matched-sales table.
--
-- Same two-phase shape, for a sharper version of the same problem:
-- count(*) OVER() cannot be computed without materialising the entire
-- filtered result set, so pairing it with a wide SELECT list made every page
-- request detoast image_urls for all matching rows to return 50.
-- ============================================================

DROP FUNCTION IF EXISTS sales_page(text,text,numeric,numeric,numeric,numeric,boolean,int,int);
DROP FUNCTION IF EXISTS sales_page(text,text,text,numeric,numeric,numeric,numeric,boolean,int,int);

CREATE OR REPLACE FUNCTION sales_page(
  p_stone_type text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL,
  p_search text DEFAULT NULL,
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
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  ),
  filtered AS (
    SELECT g.source_url, g.auction_starts
    FROM gemstone_sales g
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL
      AND g.weight_carats IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
      AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
      AND (p_origin IS NULL OR g.origin = p_origin)
      AND (p_treatment IS NULL OR g.treatment_status = p_treatment)
      AND (p_min_carat IS NULL OR g.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR g.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR g.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR g.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR g.is_certified = true)
      AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
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

GRANT EXECUTE ON FUNCTION sales_page(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int,int) TO anon;

-- ============================================================
-- Filter-option counts. stone_type_counts takes p_search so the species list
-- can show how many hits each species holds for the current query — that is
-- what makes species-scoped search navigable ("padparadscha" -> Sapphire).
-- All apply the same exclusions as the charts so counts tie out.
-- ============================================================

DROP FUNCTION IF EXISTS stone_type_counts();

CREATE OR REPLACE FUNCTION stone_type_counts(p_search text DEFAULT NULL)
RETURNS TABLE (stone_type text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  WITH hits AS (
    SELECT source_url FROM gemstone_search
    WHERE p_search IS NOT NULL AND title ILIKE '%' || p_search || '%'
  )
  SELECT coalesce(g.stone_type, 'Unclassified') AS stone_type, count(*) AS txn_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.sold_price_usd IS NOT NULL
    AND g.weight_carats IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    AND (p_search IS NULL OR EXISTS (SELECT 1 FROM hits h WHERE h.source_url = g.source_url))
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION stone_type_counts(text) TO anon;

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

CREATE OR REPLACE FUNCTION treatment_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (treatment_status text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT g.treatment_status, count(*) AS txn_count
  FROM gemstone_sales g
  WHERE g.sale_status = 'Sold'
    AND g.treatment_status IS NOT NULL AND g.treatment_status != ''
    AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    AND (p_stone_type IS NULL OR g.stone_type = p_stone_type)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION treatment_counts_for_type(text) TO anon;

DROP FUNCTION IF EXISTS color_counts_for_type(text);

NOTIFY pgrst, 'reload schema';
