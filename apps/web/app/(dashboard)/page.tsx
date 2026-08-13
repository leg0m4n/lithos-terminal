import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ActiveFiltersBar } from "@/components/dashboard/active-filters-bar";
import { HeroScatterChart } from "@/components/charts/hero-scatter-chart";
import { getMockMarketData } from "@/lib/market-data";

export default function DashboardPage() {
  const { points } = getMockMarketData();

  return (
    <div className="flex flex-col gap-7 p-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs uppercase tracking-wide">
            Phase 1 · Mock Data
          </Badge>
          <p className="text-base text-muted-foreground">
            Zircon market intelligence — asking price vs. predicted wholesale.
          </p>
        </div>

        <ActiveFiltersBar />
      </header>

      <HeroScatterChart points={points} />

      <Card className="flex min-h-[180px] flex-col items-center justify-center gap-2 border-dashed text-center">
        <p className="text-lg font-medium text-foreground">Live Arbitrage Signals</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Step 4 — live listings priced ~30% below predicted wholesale render
          here as a list.
        </p>
      </Card>
    </div>
  );
}
