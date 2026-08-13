import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { gemstones, gemstonePriceLedger } from "./schema";
import { generateMockMarket } from "./mock-generator";

const TOTAL_STONES = 500;
const BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  console.log("Clearing existing mock data...");
  await db.execute(sql`TRUNCATE TABLE ${gemstonePriceLedger}, ${gemstones} CASCADE`);

  // Random seed here (not the shared default) so re-running the seed script
  // produces a fresh market each time, unlike the app's stable demo dataset.
  const { gemstones: allGemstones, ledger: allLedgerEntries } = generateMockMarket({
    count: TOTAL_STONES,
    seed: Date.now(),
  });

  console.log(`Inserting ${allGemstones.length} gemstones...`);
  for (const batch of chunk(allGemstones, BATCH_SIZE)) {
    await db.insert(gemstones).values(batch);
  }

  console.log(`Inserting ${allLedgerEntries.length} price ledger events...`);
  for (const batch of chunk(allLedgerEntries, BATCH_SIZE)) {
    await db.insert(gemstonePriceLedger).values(batch);
  }

  const soldCount = allLedgerEntries.filter((e) => e.status === "sold").length;
  const delistedCount = allLedgerEntries.filter((e) => e.status === "delisted").length;

  console.log("Seed complete:");
  console.log(`  Stones:          ${allGemstones.length}`);
  console.log(`  Ledger events:   ${allLedgerEntries.length}`);
  console.log(`  Sold events:     ${soldCount}`);
  console.log(`  Delisted events: ${delistedCount}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
