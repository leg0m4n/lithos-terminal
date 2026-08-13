import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import type { NewGemstone, NewGemstonePriceLedgerEntry } from "./schema";

// Pure, DB-free generator. Used by seed.ts to populate Postgres AND by the
// Next.js app to render Phase 1 mock data with no live database required.

export const ORIGINS = [
  { name: "Cambodia (Ratanakiri)", priceMultiplier: 2.4, frequency: 22 },
  { name: "Sri Lanka", priceMultiplier: 1.3, frequency: 25 },
  { name: "Myanmar (Mogok)", priceMultiplier: 1.6, frequency: 12 },
  { name: "Tanzania", priceMultiplier: 1.1, frequency: 10 },
  { name: "Vietnam", priceMultiplier: 1.15, frequency: 10 },
  { name: "Madagascar", priceMultiplier: 1.05, frequency: 8 },
  { name: "Nigeria", priceMultiplier: 0.9, frequency: 6 },
  { name: "Australia", priceMultiplier: 1.0, frequency: 7 },
];

export const COLOR_CATEGORIES = [
  { name: "Sky Blue", priceMultiplier: 1.8, frequency: 28 },
  { name: "Blue-Green", priceMultiplier: 1.4, frequency: 14 },
  { name: "Champagne", priceMultiplier: 0.75, frequency: 16 },
  { name: "Golden Yellow", priceMultiplier: 0.9, frequency: 14 },
  { name: "White / Colorless", priceMultiplier: 0.7, frequency: 18 },
  { name: "Red-Brown", priceMultiplier: 0.6, frequency: 10 },
];

export const TREATMENTS = [
  { status: "unheated" as const, priceMultiplier: 1.9, frequency: 20 },
  { status: "heated_thermal" as const, priceMultiplier: 1.0, frequency: 80 },
];

export const SOURCES = [
  "gemrockauctions.com",
  "t.me/zircon_traders_kh",
  "thai-gem-exchange.com",
  "t.me/ceylon_stone_direct",
  "idar-oberstein-lot.de",
  "bangkokgemsource.net",
];

const ARBITRAGE_RATE = 0.06; // ~6% of stones seeded as live "desperation" listings

function weighted<T extends { frequency: number }>(items: T[]): T {
  return faker.helpers.weightedArrayElement(
    items.map((item) => ({ weight: item.frequency, value: item }))
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// The exponential rarity jump at 3ct and 5ct lives here.
function rarityMultiplier(carats: number): number {
  if (carats >= 10) return 22;
  if (carats >= 5) return 9;
  if (carats >= 3) return 3.4;
  if (carats >= 1) return 1.35;
  return 1;
}

function generateCaratWeight(): number {
  const roll = faker.number.float({ min: 0, max: 1 });
  if (roll < 0.5) return faker.number.float({ min: 0.3, max: 0.99, fractionDigits: 2 });
  if (roll < 0.78) return faker.number.float({ min: 1, max: 2.99, fractionDigits: 2 });
  if (roll < 0.92) return faker.number.float({ min: 3, max: 4.99, fractionDigits: 2 });
  if (roll < 0.98) return faker.number.float({ min: 5, max: 9.99, fractionDigits: 2 });
  return faker.number.float({ min: 10, max: 16, fractionDigits: 2 });
}

function computeIntrinsicWholesale(
  carats: number,
  origin: (typeof ORIGINS)[number],
  color: (typeof COLOR_CATEGORIES)[number],
  treatment: (typeof TREATMENTS)[number]
): number {
  const sizeCurve = 55 * Math.pow(carats, 0.4); // sublinear per-carat baseline
  const perCarat = sizeCurve * rarityMultiplier(carats);
  const noise = faker.number.float({ min: 0.93, max: 1.07, fractionDigits: 3 });
  return (
    perCarat *
    carats *
    origin.priceMultiplier *
    color.priceMultiplier *
    treatment.priceMultiplier *
    noise
  );
}

function jitterWholesale(base: number): number {
  return base * faker.number.float({ min: 0.95, max: 1.05, fractionDigits: 3 });
}

function buildStoneAndLedger(
  now: Date,
  forceArbitrage: boolean
): {
  gemstone: NewGemstone;
  ledger: NewGemstonePriceLedgerEntry[];
} {
  const origin = weighted(ORIGINS);
  const color = weighted(COLOR_CATEGORIES);
  const treatment = weighted(TREATMENTS);
  const carats = generateCaratWeight();

  const gemstoneId = randomUUID();
  const wholesaleBase = computeIntrinsicWholesale(carats, origin, color, treatment);

  const gemstone: NewGemstone = {
    id: gemstoneId,
    weightCarats: carats,
    colorCategory: color.name,
    treatmentStatus: treatment.status,
    origin: origin.name,
  };

  const primarySource = faker.helpers.arrayElement(SOURCES);
  const dateListed = faker.date.between({
    from: addDays(now, -540),
    to: addDays(now, -5),
  });

  const ledger: NewGemstonePriceLedgerEntry[] = [];
  let currentDate = dateListed;
  // Sellers list above their own wholesale expectation, hoping for retail.
  let currentPrice =
    wholesaleBase * faker.number.float({ min: 1.15, max: 1.45, fractionDigits: 3 });

  ledger.push({
    gemstoneId,
    recordedAt: currentDate,
    askingPriceUsd: currentPrice.toFixed(2),
    predictedWholesaleUsd: jitterWholesale(wholesaleBase).toFixed(2),
    status: "active",
    sourceUrl: primarySource,
  });

  const numDrops = faker.number.int({ min: 0, max: 3 });
  for (let i = 0; i < numDrops; i++) {
    const nextDate = addDays(currentDate, faker.number.int({ min: 7, max: 28 }));
    if (nextDate > now) break;
    currentDate = nextDate;
    const dropPct = faker.number.float({ min: 0.05, max: 0.22, fractionDigits: 3 });
    currentPrice *= 1 - dropPct;
    ledger.push({
      gemstoneId,
      recordedAt: currentDate,
      askingPriceUsd: currentPrice.toFixed(2),
      predictedWholesaleUsd: jitterWholesale(wholesaleBase).toFixed(2),
      status: "price_drop",
      sourceUrl: primarySource,
    });
  }

  const terminalDate = addDays(currentDate, faker.number.int({ min: 3, max: 21 }));
  const terminalRoll = faker.number.float({ min: 0, max: 1 });

  if (terminalDate <= now && terminalRoll < 0.55) {
    // Sold — usually settles at or just below the last asking price.
    currentDate = terminalDate;
    currentPrice *= faker.number.float({ min: 0.85, max: 1.0, fractionDigits: 3 });
    ledger.push({
      gemstoneId,
      recordedAt: currentDate,
      askingPriceUsd: currentPrice.toFixed(2),
      predictedWholesaleUsd: jitterWholesale(wholesaleBase).toFixed(2),
      status: "sold",
      sourceUrl: primarySource,
    });
  } else if (terminalDate <= now && terminalRoll < 0.75) {
    // Delisted — sometimes consigned to a different platform (cross-hub flow).
    currentDate = terminalDate;
    ledger.push({
      gemstoneId,
      recordedAt: currentDate,
      askingPriceUsd: currentPrice.toFixed(2),
      predictedWholesaleUsd: jitterWholesale(wholesaleBase).toFixed(2),
      status: "delisted",
      sourceUrl:
        faker.helpers.maybe(() => faker.helpers.arrayElement(SOURCES), {
          probability: 0.15,
        }) ?? primarySource,
    });
  }
  // otherwise: stone is still live — the last pushed event is its current state

  const lastEvent = ledger[ledger.length - 1];
  if (forceArbitrage && lastEvent.status !== "sold") {
    // "Desperation" signal: force a live listing well below the model's
    // wholesale estimate, dated in the last few days.
    const arbitrageDate = addDays(now, -faker.number.int({ min: 1, max: 4 }));
    const arbitragePrice =
      wholesaleBase * faker.number.float({ min: 0.6, max: 0.72, fractionDigits: 3 });
    ledger.push({
      gemstoneId,
      recordedAt: arbitrageDate,
      askingPriceUsd: arbitragePrice.toFixed(2),
      predictedWholesaleUsd: jitterWholesale(wholesaleBase).toFixed(2),
      status: "price_drop",
      sourceUrl: primarySource,
    });
  }

  return { gemstone, ledger };
}

export interface MockMarket {
  gemstones: NewGemstone[];
  ledger: NewGemstonePriceLedgerEntry[];
}

export interface GenerateMockMarketOptions {
  count?: number;
  arbitrageRate?: number;
  seed?: number;
  now?: Date;
}

export function generateMockMarket(options: GenerateMockMarketOptions = {}): MockMarket {
  const { count = 500, arbitrageRate = ARBITRAGE_RATE, seed = 20260811, now = new Date() } =
    options;

  faker.seed(seed);

  const gemstones: NewGemstone[] = [];
  const ledger: NewGemstonePriceLedgerEntry[] = [];

  for (let i = 0; i < count; i++) {
    const forceArbitrage = i < count * arbitrageRate;
    const built = buildStoneAndLedger(now, forceArbitrage);
    gemstones.push(built.gemstone);
    ledger.push(...built.ledger);
  }

  return { gemstones, ledger };
}
