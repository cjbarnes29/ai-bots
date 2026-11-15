interface QueryState {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  dataUpdatedAt: number;
}

/** Presentation only: failed reads never become empty or reassuring zero states. */
export function QueryStatus({ query, label, freshness = false }: { query: QueryState; label: string; freshness?: boolean }) {
  if (query.isError) return <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">Could not load {label}.{query.data !== undefined ? ` Showing the last available data${query.dataUpdatedAt ? ` from ${new Date(query.dataUpdatedAt).toLocaleString()}` : ""}; it may be out of date.` : " Try again when the connection returns."}</p>;
  if (query.isPending && query.data === undefined) return <p role="status" className="hint">Loading {label}…</p>;
  if (freshness && query.dataUpdatedAt > 0) return <p className="hint">Last updated {new Date(query.dataUpdatedAt).toLocaleString()}</p>;
  return null;
}
