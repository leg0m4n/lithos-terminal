"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FilterProvider } from "@/lib/filter-context";
import { Logo } from "@/components/sidebar/logo";
import { CompsCriteria } from "@/components/comps/comps-criteria";
import { PriceDistributionChart } from "@/components/charts/price-distribution-chart";
import { GemstoneGrid } from "@/components/dashboard/gemstone-grid";
import type { StoneTypeOption } from "@/lib/market-data";

interface CompsModeProps {
  stoneTypeOptions: StoneTypeOption[];
}

// A separate mode, not another card on the dashboard. The dashboard answers
// "how is this market moving?"; this answers "what is THIS stone worth?" —
// and stacking the second under the first buried the answer. Criteria first,
// evidence below, nothing else competing for attention.
export function CompsMode({ stoneTypeOptions }: CompsModeProps) {
  return (
    <FilterProvider defaultStoneType={stoneTypeOptions[0]?.value ?? "all"}>
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Market dashboard
          </Link>
        </header>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium text-foreground">Comparable sales</h1>
          <p className="text-base text-muted-foreground">
            Describe a stone and see what comparable ones actually sold for. Every result is a completed
            sale, not an appraisal.
          </p>
        </div>

        <CompsCriteria stoneTypeOptions={stoneTypeOptions} />

        <PriceDistributionChart showQuality />

        <GemstoneGrid />

        <p className="pb-8 text-xs text-muted-foreground">
          Matching is on species, weight, origin, treatment and certification — the attributes this dataset
          records reliably. Colour, clarity and cut quality are not yet part of the match, and within a
          single species they can move price by more than everything above combined. Read the spread, not
          just the median.
        </p>
      </div>
    </FilterProvider>
  );
}
