import type { ReactNode } from "react";
import { FilterProvider } from "@/lib/filter-context";
import { FilterSidebar } from "@/components/sidebar/filter-sidebar";
import { getOriginOptions, getStoneTypeOptions } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [originOptions, stoneTypeOptions] = await Promise.all([
    getOriginOptions(),
    getStoneTypeOptions(),
  ]);

  // Highest-count real stone type — options are already sorted count-desc
  // with "Unclassified" sunk to the bottom, so [0] is the right pick.
  const defaultStoneType = stoneTypeOptions[0]?.value ?? "all";

  return (
    <FilterProvider defaultStoneType={defaultStoneType}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <FilterSidebar originOptions={originOptions} stoneTypeOptions={stoneTypeOptions} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </FilterProvider>
  );
}
