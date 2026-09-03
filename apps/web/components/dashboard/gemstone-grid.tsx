"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFilters } from "@/lib/filter-context";
import { getSalesPage, GRID_PAGE_SIZE } from "@/lib/market-data";
import { useAsyncData } from "@/lib/use-async-data";

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

export function GemstoneGrid() {
  const { stoneType, origin, color, caratRange, priceRange, certifiedOnly } = useFilters();
  const [page, setPage] = useState(0);

  // Any filter change should snap back to page 0 — staying on page 12 of a
  // now-much-smaller filtered set would just show an empty page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting local pagination in response to external filter state changing
    setPage(0);
  }, [stoneType, origin, color, caratRange, priceRange, certifiedOnly]);

  const {
    data: result,
    loading,
    error,
    retry,
  } = useAsyncData(
    () => getSalesPage({ stoneType, origin, color, caratRange, priceRange, certifiedOnly }, page),
    [stoneType, origin, color, caratRange, priceRange, certifiedOnly, page]
  );
  const listings = result?.rows ?? [];
  const totalCount = result?.totalCount ?? 0;

  const pageCount = Math.max(1, Math.ceil(totalCount / GRID_PAGE_SIZE));

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium text-foreground">Sold Listings</p>
          <p className="text-sm text-muted-foreground">
            {totalCount.toLocaleString()} sales matching current filters
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </Button>
          <span className="tabular-nums">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
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
            {error ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <span>Failed to load — this is usually a transient database timeout.</span>
                    <Button variant="outline" size="sm" onClick={retry}>
                      Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : loading && listings.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : listings.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No sales match the current filters.
                </td>
              </tr>
            ) : (
              listings.map((listing) => (
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
