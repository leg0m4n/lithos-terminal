import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActiveFiltersBar } from "@/components/dashboard/active-filters-bar";
import { HistoricPriceChart } from "@/components/charts/historic-price-chart";
import { MarketActivityChart } from "@/components/charts/market-activity-chart";
import { TopSalesLeaderboard } from "@/components/dashboard/top-sales-leaderboard";
import { GemstoneGrid } from "@/components/dashboard/gemstone-grid";

// Without this, Next prerenders "/" once at build time and every visitor
// gets that frozen snapshot until the next deploy — not what "Live ·
// Supabase" is supposed to mean.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-7 p-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs uppercase tracking-wide">
            Live · Supabase
          </Badge>
          <p className="text-base text-muted-foreground">
            Gemstone market intelligence — how these markets are moving.
          </p>
        </div>

        {/* The dashboard answers "how is this market moving?". Valuing one
            specific stone is a different question, so it gets its own mode. */}
        <Link
          href="/comps"
          className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary transition-opacity hover:opacity-80"
        >
          Look up comparable sales for a specific stone
          <ArrowRight className="size-4" />
        </Link>

        <ActiveFiltersBar />
      </header>

      <HistoricPriceChart />

      <MarketActivityChart />

      <TopSalesLeaderboard />

      <GemstoneGrid />
    </div>
  );
}
