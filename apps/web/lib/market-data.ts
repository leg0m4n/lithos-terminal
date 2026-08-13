import { cache } from "react";
import {
  generateMockMarket,
  type NewGemstone,
  type NewGemstonePriceLedgerEntry,
} from "@lithos/db/mock";

export interface MarketPoint {
  gemstoneId: string;
  recordedAt: string; // ISO — Date instances can't cross the server/client boundary as props
  askingPriceUsd: number;
  predictedWholesaleUsd: number;
  pricePerCarat: number;
  status: NonNullable<NewGemstonePriceLedgerEntry["status"]>;
  sourceUrl: string | null;
  weightCarats: number;
  origin: string;
  colorCategory: string;
  treatmentStatus: NewGemstone["treatmentStatus"];
}

function toMarketPoints(
  gemstones: NewGemstone[],
  ledger: NewGemstonePriceLedgerEntry[]
): MarketPoint[] {
  const gemstoneById = new Map(gemstones.map((g) => [g.id as string, g]));

  return ledger
    .map((entry): MarketPoint | null => {
      const gemstone = gemstoneById.get(entry.gemstoneId);
      if (!gemstone) return null;

      const askingPriceUsd = Number(entry.askingPriceUsd);

      return {
        gemstoneId: entry.gemstoneId,
        recordedAt: new Date(entry.recordedAt as Date).toISOString(),
        askingPriceUsd,
        predictedWholesaleUsd: Number(entry.predictedWholesaleUsd),
        pricePerCarat: askingPriceUsd / gemstone.weightCarats,
        status: entry.status ?? "active",
        sourceUrl: entry.sourceUrl ?? null,
        weightCarats: gemstone.weightCarats,
        origin: gemstone.origin,
        colorCategory: gemstone.colorCategory,
        treatmentStatus: gemstone.treatmentStatus,
      };
    })
    .filter((point): point is MarketPoint => point !== null)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

// Cached per request so every server component on the page (chart, arbitrage
// list) reads the same generated market instead of re-rolling it.
export const getMockMarketData = cache((): { points: MarketPoint[] } => {
  const { gemstones, ledger } = generateMockMarket({ count: 500 });
  return { points: toMarketPoints(gemstones, ledger) };
});
