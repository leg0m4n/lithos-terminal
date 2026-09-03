"use client";

import { useEffect, useState, type DependencyList } from "react";

export interface AsyncDataState<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

// Every filter-driven fetch in this dashboard (chart, grid, leaderboard,
// scoped dropdown options) had the same gap: no .catch(), so a transient
// failure (RPC timeout under the scraper's write load, network blip) left
// `data` at its previous/empty value with no signal anything went wrong —
// indistinguishable from "genuinely no matches." Confirmed live: switching
// to a stone type mid-write-load hit a Postgres statement timeout once,
// which silently fell through to the "no sales match" empty state.
export function useAsyncData<T>(fetchFn: () => Promise<T>, deps: DependencyList): AsyncDataState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change is the documented pattern for this (react.dev "Fetching data")
    setLoading(true);
    setError(false);
    fetchFn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's own dependency list, spread below; fetchFn deliberately excluded (would defeat the point of an explicit deps list)
  }, [...deps, retryTick]);

  return { data, loading, error, retry: () => setRetryTick((t) => t + 1) };
}
