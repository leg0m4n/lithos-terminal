import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  doublePrecision,
  numeric,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const treatmentStatusEnum = pgEnum("treatment_status", [
  "unheated",
  "heated_thermal",
]);

export const listingStatusEnum = pgEnum("listing_status", [
  "active",
  "price_drop",
  "sold",
  "delisted",
]);

// Table A — the physical asset. Immutable once cut/certified.
export const gemstones = pgTable(
  "gemstones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    weightCarats: doublePrecision("weight_carats").notNull(),
    colorCategory: varchar("color_category", { length: 32 }).notNull(),
    treatmentStatus: treatmentStatusEnum("treatment_status").notNull(),
    origin: varchar("origin", { length: 64 }).notNull(),
  },
  (table) => ({
    originIdx: index("gemstones_origin_idx").on(table.origin),
    treatmentIdx: index("gemstones_treatment_status_idx").on(
      table.treatmentStatus
    ),
    weightIdx: index("gemstones_weight_carats_idx").on(table.weightCarats),
  })
);

// Table B — append-only financial time-series. One row per observed
// price/status event for a given stone, across however many platforms
// a scraper picks it up on.
export const gemstonePriceLedger = pgTable(
  "gemstone_price_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    gemstoneId: uuid("gemstone_id")
      .notNull()
      .references(() => gemstones.id, { onDelete: "cascade" }),

    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    askingPriceUsd: numeric("asking_price_usd", {
      precision: 10,
      scale: 2,
    }).notNull(),

    predictedWholesaleUsd: numeric("predicted_wholesale_usd", {
      precision: 10,
      scale: 2,
    }).notNull(),

    status: listingStatusEnum("status").notNull().default("active"),

    sourceUrl: text("source_url"),
  },
  (table) => ({
    gemstoneIdx: index("ledger_gemstone_id_idx").on(table.gemstoneId),
    recordedAtIdx: index("ledger_recorded_at_idx").on(table.recordedAt),
    statusIdx: index("ledger_status_idx").on(table.status),
    // backs "latest price per stone" — the query the hero chart and
    // arbitrage stub both run
    gemstoneRecordedIdx: index("ledger_gemstone_recorded_idx").on(
      table.gemstoneId,
      table.recordedAt
    ),
  })
);

export type Gemstone = typeof gemstones.$inferSelect;
export type NewGemstone = typeof gemstones.$inferInsert;
export type GemstonePriceLedgerEntry = typeof gemstonePriceLedger.$inferSelect;
export type NewGemstonePriceLedgerEntry =
  typeof gemstonePriceLedger.$inferInsert;
