import type { ReactNode } from "react";
import { FilterProvider } from "@/lib/filter-context";
import { FilterSidebar } from "@/components/sidebar/filter-sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <FilterProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <FilterSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </FilterProvider>
  );
}
