"use client";

import { useMemo } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { useFilters } from "@/lib/filter-context";
import { filterSales, type GemstoneSale } from "@/lib/market-data";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const GRID_SIZE = 50;

interface GemstoneGridProps {
  sales: GemstoneSale[];
}

export function GemstoneGrid({ sales }: GemstoneGridProps) {
  const { stoneType, treatmentStatuses, origin, caratRange } = useFilters();

  // `sales` arrives sorted by auction_starts descending from the server
  // query, so slicing after filtering keeps "most recent" semantics.
  const listings = useMemo(
    () => filterSales(sales, { stoneType, treatmentStatuses, origin, caratRange }).slice(0, GRID_SIZE),
    [sales, stoneType, treatmentStatuses, origin, caratRange]
  );

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <p className="text-lg font-medium text-foreground">Sold Listings</p>
        <p className="text-sm text-muted-foreground">
          {listings.length.toLocaleString()} most recent sales
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Stone</th>
              <th className="py-2 pr-3 font-medium">Carat</th>
              <th className="py-2 pr-3 font-medium">Price</th>
              <th className="py-2 pr-3 font-medium">Origin</th>
              <th className="py-2 pr-3 font-medium">Auction Start</th>
              <th className="py-2 pr-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr
                key={listing.sourceUrl}
                className="border-b border-border/30 last:border-b-0 hover:bg-muted/40"
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3">
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                      {listing.imageUrl ? (
                        <Image
                          src={listing.imageUrl}
                          alt={listing.stoneType ?? "Gemstone"}
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {listing.stoneType ?? "Unclassified"}
                      </span>
                      {listing.colorCategory ? (
                        <span className="text-xs text-muted-foreground">{listing.colorCategory}</span>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-3 tabular-nums text-foreground">
                  {listing.weightCarats.toFixed(2)}ct
                </td>
                <td className="py-2 pr-3 tabular-nums text-foreground">
                  {currencyFormatter.format(listing.priceUsd)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{listing.origin ?? "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {listing.auctionStartsAt ? dateFormatter.format(new Date(listing.auctionStartsAt)) : "—"}
                </td>
                <td className="py-2 pr-3">
                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    {sourceDomain(listing.sourceUrl)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
