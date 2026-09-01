import type { ReactNode } from "react";
import { FilterProvider } from "@/lib/filter-context";
import { FilterSidebar } from "@/components/sidebar/filter-sidebar";
import { getMarketData, getStoneTypeOptions } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // getMarketData is wrapped in React's cache(), so this and the page's own
  // call for the same request dedupe to a single Supabase round trip — the
  // sidebar needs the full sales set to scope its Origin dropdown to the
  // selected stone type.
  const [{ sales }, stoneTypeOptions] = await Promise.all([
    getMarketData(),
    getStoneTypeOptions(),
  ]);

  // Highest-count real stone type — options are already sorted count-desc
  // with "Unclassified" sunk to the bottom, so [0] is the right pick.
  const defaultStoneType = stoneTypeOptions[0]?.value ?? "all";

  return (
    <FilterProvider defaultStoneType={defaultStoneType}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <FilterSidebar sales={sales} stoneTypeOptions={stoneTypeOptions} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </FilterProvider>
  );
}
