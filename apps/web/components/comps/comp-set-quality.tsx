"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// How much to trust this comp set — the thing that makes the number usable
// by someone else. A set of 4 sales spanning $10-$4,000 is noise; 60 sales
// in a tight band is evidence. Saying which is which is the difference
// between a tool and a number generator, especially when quality attributes
// (colour, cut grade) are still not derivable from the data.
const MIN_USABLE = 8;
const MIN_STRONG = 25;
const TIGHT_SPREAD = 3; // p75/p25
const WIDE_SPREAD = 8;

export type CompQuality = "strong" | "usable" | "weak" | "insufficient";

export function assessCompSet(n: number, p25: number, p75: number): {
  quality: CompQuality;
  spread: number;
  headline: string;
  detail: string;
} {
  const spread = p25 > 0 ? p75 / p25 : Infinity;

  if (n < MIN_USABLE) {
    return {
      quality: "insufficient",
      spread,
      headline: "Too few comparable sales",
      detail: `Only ${n} match. Widen the carat tolerance, drop a filter, or accept that this configuration is genuinely rare.`,
    };
  }
  if (spread >= WIDE_SPREAD) {
    return {
      quality: "weak",
      spread,
      headline: "Very wide price spread",
      detail: `The middle half of these sales still spans ${spread.toFixed(1)}x. Something unmodelled — most likely colour and cut quality — is driving price more than the filters you set. Treat the median as a rough anchor, not a valuation.`,
    };
  }
  if (n >= MIN_STRONG && spread <= TIGHT_SPREAD) {
    return {
      quality: "strong",
      spread,
      headline: "Tight, well-populated comp set",
      detail: `${n} sales with the middle half inside a ${spread.toFixed(1)}x band. This is about as defensible as this dataset gets.`,
    };
  }
  return {
    quality: "usable",
    spread,
    headline: "Usable, with caveats",
    detail: `${n} sales, middle half spanning ${spread.toFixed(1)}x. Enough to argue from, loose enough that individual stone quality still dominates.`,
  };
}

const STYLES: Record<CompQuality, { ring: string; text: string; Icon: typeof Info }> = {
  strong: { ring: "border-emerald-500/40 bg-emerald-500/5", text: "text-emerald-400", Icon: CheckCircle2 },
  usable: { ring: "border-border bg-muted/20", text: "text-foreground", Icon: Info },
  weak: { ring: "border-amber-500/40 bg-amber-500/5", text: "text-amber-400", Icon: AlertTriangle },
  insufficient: { ring: "border-amber-500/40 bg-amber-500/5", text: "text-amber-400", Icon: AlertTriangle },
};

export function CompSetQuality({ n, p25, p75 }: { n: number; p25: number; p75: number }) {
  const { quality, headline, detail } = assessCompSet(n, p25, p75);
  const { ring, text, Icon } = STYLES[quality];

  return (
    <div className={cn("flex gap-3 rounded-lg border p-4", ring)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", text)} />
      <div className="flex flex-col gap-1">
        <p className={cn("text-sm font-medium", text)}>{headline}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
