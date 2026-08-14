import { Badge } from "@/components/ui/badge";
import { ActiveFiltersBar } from "@/components/dashboard/active-filters-bar";
import { HeroScatterChart } from "@/components/charts/hero-scatter-chart";
import { GemstoneGrid } from "@/components/dashboard/gemstone-grid";
import { getMarketData } from "@/lib/market-data";

const GRID_SIZE = 50;

export default async function DashboardPage() {
  const { sales } = await getMarketData();

  return (
    <div className="flex flex-col gap-7 p-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs uppercase tracking-wide">
            Live · Supabase
          </Badge>
          <p className="text-base text-muted-foreground">
            Zircon market intelligence — sold price vs. carat weight.
          </p>
        </div>

        <ActiveFiltersBar />
      </header>

      <HeroScatterChart sales={sales} />

      <GemstoneGrid listings={sales.slice(0, GRID_SIZE)} />
    </div>
  );
}
