import type { ReactNode } from "react";
import { FilterProvider } from "@/lib/filter-context";
import { FilterSidebar } from "@/components/sidebar/filter-sidebar";
import { getOriginOptions } from "@/lib/market-data";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const originOptions = await getOriginOptions();

  return (
    <FilterProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <FilterSidebar originOptions={originOptions} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </FilterProvider>
  );
}
