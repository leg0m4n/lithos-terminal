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
-- gemstone_analytics — THE table the dashboard actually queries.
--
-- A narrow, pre-cleaned mirror: one row per usable sold listing, only the
-- columns the charts need, junk already removed, price_per_carat and the
-- searchable title precomputed onto the row.
--
-- This exists because three separate performance disasters all had the same
-- root cause — querying the wide gemstone_sales table directly:
--   1. Filtering junk with a regex over metadata->>'raw_title' detoasted a
--      JSONB blob per row: 19.6s.
--   2. Replacing that with an anti-join against gemstone_excluded_lots fixed
--      the direct case, but PostgREST calls functions via LATERAL with
--      arguments from json_to_record, so the parameters are NEVER constants
--      at plan time. The planner estimated 1 row, chose a nested loop, and
--      seq-scanned the 8k-row exclusion table 5,141 times — 42.7 MILLION
--      comparisons, 9.9s. This is why psql looked fast (46-97ms with
--      literals or PREPARE) while the live dashboard timed out: the plan
--      differs entirely. Always reproduce a PostgREST timing with the
--      LATERAL/json_to_record shape, not a psql literal.
--   3. Text search had its own version of the same story — see
--      gemstone_search above.
--
-- Querying one narrow table with real statistics removes all of it: the
-- anti-join is gone (junk never enters), the heap is narrow, and search is a
-- local column. The worst case measured went 3.1s-timeout -> 0.17s.
--
-- NOT self-maintaining. refresh_analytics() must run after the scraper adds
-- rows; it chains refresh_excluded_lots() and refresh_search_index() first,
-- inserts newly-clean rows, and deletes rows since classified as junk.
-- ============================================================

CREATE TABLE IF NOT EXISTS gemstone_analytics (
  source_url       text PRIMARY KEY,
  stone_type       text,
  title            text,
  sold_price_usd   numeric NOT NULL,
  weight_carats    numeric NOT NULL,
  price_per_carat  numeric NOT NULL,
  origin           text,
  treatment_status text,
  is_certified     boolean,
  auction_starts   timestamptz NOT NULL
);

GRANT SELECT ON gemstone_analytics TO anon;

CREATE OR REPLACE FUNCTION refresh_analytics()
RETURNS TABLE (inserted bigint, removed bigint)
LANGUAGE plpgsql AS $$
DECLARE ins bigint; del bigint;
BEGIN
  PERFORM refresh_excluded_lots();
  PERFORM refresh_search_index();

  WITH new_rows AS (
    INSERT INTO gemstone_analytics
      (source_url, stone_type, title, sold_price_usd, weight_carats,
       price_per_carat, origin, treatment_status, is_certified, auction_starts)
    SELECT g.source_url, g.stone_type, s.title, g.sold_price_usd, g.weight_carats,
           g.sold_price_usd / g.weight_carats, g.origin, g.treatment_status,
           g.is_certified, g.auction_starts
    FROM gemstone_sales g
    LEFT JOIN gemstone_search s ON s.source_url = g.source_url
    WHERE g.sale_status = 'Sold'
      AND g.sold_price_usd IS NOT NULL AND g.sold_price_usd > 0
      AND g.weight_carats IS NOT NULL AND g.weight_carats > 0
      AND g.auction_starts IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gemstone_excluded_lots e WHERE e.source_url = g.source_url)
    ON CONFLICT (source_url) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO ins FROM new_rows;

  WITH gone AS (
    DELETE FROM gemstone_analytics a
    USING gemstone_excluded_lots e
    WHERE e.source_url = a.source_url
    RETURNING 1
  ) SELECT count(*) INTO del FROM gone;

  RETURN QUERY SELECT ins, del;
END $$;

-- ============================================================
-- Indexes
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Species leads every index: there is no "All Stones" view any more, so
-- stone_type is set on effectively every dashboard query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga_type_time
  ON gemstone_analytics (stone_type, auction_starts);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga_type_price
  ON gemstone_analytics (stone_type, sold_price_usd DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ga_title_trgm
  ON gemstone_analytics USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gemstone_search_title_trgm
  ON gemstone_search USING gin (title gin_trgm_ops);

-- ============================================================
-- RPCs. Every one applies the same filter block against
-- gemstone_analytics. Grid/leaderboard join back to gemstone_sales
-- only for image_urls, and only for the rows actually returned.
-- ============================================================

-- Shared filter block, applied identically everywhere. All columns live on
-- the narrow gemstone_analytics table, so these are plain predicates on real
-- statistics: no anti-join, no TOASTed JSONB, no cross-table search join.
DROP FUNCTION IF EXISTS historic_price_trend(text,text,text,text,numeric,numeric,numeric,numeric,boolean);

CREATE OR REPLACE FUNCTION historic_price_trend(
  p_stone_type text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL, p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL, p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false
)
RETURNS TABLE (month timestamptz, weight_tier text, tier_order int,
               median_price_per_carat numeric, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', a.auction_starts) AS month,
    CASE WHEN a.weight_carats < 1 THEN '<1ct' WHEN a.weight_carats < 3 THEN '1-3ct'
         WHEN a.weight_carats < 5 THEN '3-5ct' WHEN a.weight_carats < 10 THEN '5-10ct'
         ELSE '10ct+' END AS weight_tier,
    CASE WHEN a.weight_carats < 1 THEN 0 WHEN a.weight_carats < 3 THEN 1
         WHEN a.weight_carats < 5 THEN 2 WHEN a.weight_carats < 10 THEN 3
         ELSE 4 END AS tier_order,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY a.price_per_carat) AS median_price_per_carat,
    count(*) AS txn_count
  FROM gemstone_analytics a
  WHERE (p_stone_type IS NULL OR a.stone_type = p_stone_type)
    AND (p_origin IS NULL OR a.origin = p_origin)
    AND (p_treatment IS NULL OR a.treatment_status = p_treatment)
    AND (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
    AND (p_min_carat IS NULL OR a.weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR a.weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR a.sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR a.sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR a.is_certified = true)
  GROUP BY 1, 2, 3
  ORDER BY 1, 3;
$$;
GRANT EXECUTE ON FUNCTION historic_price_trend(text,text,text,text,numeric,numeric,numeric,numeric,boolean) TO anon;

DROP FUNCTION IF EXISTS market_activity(text,text,text,text,numeric,numeric,numeric,numeric,boolean,text);
CREATE OR REPLACE FUNCTION market_activity(
  p_stone_type text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL, p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL, p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false, p_bucket text DEFAULT 'month'
)
RETURNS TABLE (bucket timestamptz, sale_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc(CASE WHEN p_bucket IN ('day','week','month') THEN p_bucket ELSE 'month' END,
                    a.auction_starts) AS bucket,
         count(*) AS sale_count
  FROM gemstone_analytics a
  WHERE (p_stone_type IS NULL OR a.stone_type = p_stone_type)
    AND (p_origin IS NULL OR a.origin = p_origin)
    AND (p_treatment IS NULL OR a.treatment_status = p_treatment)
    AND (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
    AND (p_min_carat IS NULL OR a.weight_carats >= p_min_carat)
    AND (p_max_carat IS NULL OR a.weight_carats <= p_max_carat)
    AND (p_min_price IS NULL OR a.sold_price_usd >= p_min_price)
    AND (p_max_price IS NULL OR a.sold_price_usd <= p_max_price)
    AND (NOT p_certified_only OR a.is_certified = true)
  GROUP BY 1 ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION market_activity(text,text,text,text,numeric,numeric,numeric,numeric,boolean,text) TO anon;

DROP FUNCTION IF EXISTS price_distribution(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int);
CREATE OR REPLACE FUNCTION price_distribution(
  p_stone_type text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL, p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL, p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false, p_bins int DEFAULT 24
)
RETURNS TABLE (bin_index int, bin_low numeric, bin_high numeric, sale_count bigint,
               total_count bigint, p25 numeric, p50 numeric, p75 numeric,
               min_price numeric, max_price numeric, median_price_per_carat numeric)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT a.sold_price_usd AS price, a.price_per_carat AS ppc
    FROM gemstone_analytics a
    WHERE (p_stone_type IS NULL OR a.stone_type = p_stone_type)
      AND (p_origin IS NULL OR a.origin = p_origin)
      AND (p_treatment IS NULL OR a.treatment_status = p_treatment)
      AND (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
      AND (p_min_carat IS NULL OR a.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR a.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR a.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR a.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR a.is_certified = true)
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
    SELECT least(width_bucket(ln(f.price::double precision), ln(s.mn::double precision),
                              ln(s.mx::double precision), p_bins), p_bins) AS bi, count(*) AS c
    FROM filtered f CROSS JOIN stats s WHERE s.mx > s.mn GROUP BY 1
  )
  SELECT i AS bin_index,
    round(exp(ln(s.mn::double precision) + (i-1)*(ln(s.mx::double precision)-ln(s.mn::double precision))/p_bins)::numeric, 2),
    round(exp(ln(s.mn::double precision) + i*(ln(s.mx::double precision)-ln(s.mn::double precision))/p_bins)::numeric, 2),
    coalesce(b.c, 0), s.n, s.q25, s.q50, s.q75, s.mn, s.mx, s.mppc
  FROM generate_series(1, p_bins) AS i
  CROSS JOIN stats s LEFT JOIN binned b ON b.bi = i
  WHERE s.n > 0 AND s.mx > s.mn
  ORDER BY i;
$$;
GRANT EXECUTE ON FUNCTION price_distribution(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

-- Grid/leaderboard still need image_urls, which only exists on the wide
-- table — so they pick rows from gemstone_analytics first and join back for
-- the payload of just the rows actually returned.
DROP FUNCTION IF EXISTS top_price_outliers(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int);
CREATE OR REPLACE FUNCTION top_price_outliers(
  p_stone_type text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL, p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL, p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false, p_limit int DEFAULT 50
)
RETURNS TABLE (source_url text, stone_type text, sold_price_usd numeric, weight_carats numeric,
  color_category text, origin text, treatment_status text, shape text, cut_style text,
  clarity text, is_certified boolean, certification_lab text, auction_starts timestamptz,
  image_urls jsonb)
LANGUAGE sql STABLE AS $$
  WITH top AS (
    SELECT a.source_url, a.sold_price_usd FROM gemstone_analytics a
    WHERE (p_stone_type IS NULL OR a.stone_type = p_stone_type)
      AND (p_origin IS NULL OR a.origin = p_origin)
      AND (p_treatment IS NULL OR a.treatment_status = p_treatment)
      AND (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
      AND (p_min_carat IS NULL OR a.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR a.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR a.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR a.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR a.is_certified = true)
    ORDER BY a.sold_price_usd DESC LIMIT p_limit
  )
  SELECT g.source_url, g.stone_type, g.sold_price_usd, g.weight_carats, g.color_category,
    g.origin, g.treatment_status, g.shape, g.cut_style, g.clarity, g.is_certified,
    g.certification_lab, g.auction_starts, g.image_urls
  FROM top t JOIN gemstone_sales g ON g.source_url = t.source_url
  ORDER BY t.sold_price_usd DESC;
$$;
GRANT EXECUTE ON FUNCTION top_price_outliers(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int) TO anon;

DROP FUNCTION IF EXISTS sales_page(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int,int);
CREATE OR REPLACE FUNCTION sales_page(
  p_stone_type text DEFAULT NULL, p_origin text DEFAULT NULL,
  p_treatment text DEFAULT NULL, p_search text DEFAULT NULL,
  p_min_carat numeric DEFAULT NULL, p_max_carat numeric DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL,
  p_certified_only boolean DEFAULT false, p_limit int DEFAULT 50, p_offset int DEFAULT 0
)
RETURNS TABLE (source_url text, stone_type text, sold_price_usd numeric, weight_carats numeric,
  color_category text, origin text, treatment_status text, shape text, cut_style text,
  clarity text, is_certified boolean, certification_lab text, auction_starts timestamptz,
  image_urls jsonb, total_count bigint)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT a.source_url, a.auction_starts FROM gemstone_analytics a
    WHERE (p_stone_type IS NULL OR a.stone_type = p_stone_type)
      AND (p_origin IS NULL OR a.origin = p_origin)
      AND (p_treatment IS NULL OR a.treatment_status = p_treatment)
      AND (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
      AND (p_min_carat IS NULL OR a.weight_carats >= p_min_carat)
      AND (p_max_carat IS NULL OR a.weight_carats <= p_max_carat)
      AND (p_min_price IS NULL OR a.sold_price_usd >= p_min_price)
      AND (p_max_price IS NULL OR a.sold_price_usd <= p_max_price)
      AND (NOT p_certified_only OR a.is_certified = true)
  ),
  total AS (SELECT count(*) AS c FROM filtered),
  page AS (SELECT source_url, auction_starts FROM filtered ORDER BY auction_starts DESC LIMIT p_limit OFFSET p_offset)
  SELECT g.source_url, g.stone_type, g.sold_price_usd, g.weight_carats, g.color_category,
    g.origin, g.treatment_status, g.shape, g.cut_style, g.clarity, g.is_certified,
    g.certification_lab, g.auction_starts, g.image_urls, t.c
  FROM page p JOIN gemstone_sales g ON g.source_url = p.source_url CROSS JOIN total t
  ORDER BY p.auction_starts DESC;
$$;
GRANT EXECUTE ON FUNCTION sales_page(text,text,text,text,numeric,numeric,numeric,numeric,boolean,int,int) TO anon;

DROP FUNCTION IF EXISTS stone_type_counts(text);
CREATE OR REPLACE FUNCTION stone_type_counts(p_search text DEFAULT NULL)
RETURNS TABLE (stone_type text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(a.stone_type, 'Unclassified'), count(*)
  FROM gemstone_analytics a
  WHERE (p_search IS NULL OR a.title ILIKE '%' || p_search || '%')
  GROUP BY 1 ORDER BY 2 DESC;
$$;
GRANT EXECUTE ON FUNCTION stone_type_counts(text) TO anon;

CREATE OR REPLACE FUNCTION origin_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (origin text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT a.origin, count(*) FROM gemstone_analytics a
  WHERE a.origin IS NOT NULL AND a.origin != ''
    AND (p_stone_type IS NULL OR a.stone_type = p_stone_type)
  GROUP BY 1 ORDER BY 2 DESC;
$$;
GRANT EXECUTE ON FUNCTION origin_counts_for_type(text) TO anon;

CREATE OR REPLACE FUNCTION treatment_counts_for_type(p_stone_type text DEFAULT NULL)
RETURNS TABLE (treatment_status text, txn_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT a.treatment_status, count(*) FROM gemstone_analytics a
  WHERE a.treatment_status IS NOT NULL AND a.treatment_status != ''
    AND (p_stone_type IS NULL OR a.stone_type = p_stone_type)
  GROUP BY 1 ORDER BY 2 DESC;
$$;
GRANT EXECUTE ON FUNCTION treatment_counts_for_type(text) TO anon;

NOTIFY pgrst, 'reload schema';
