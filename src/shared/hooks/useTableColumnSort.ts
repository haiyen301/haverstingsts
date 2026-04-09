"use client";

import { useCallback, useState } from "react";
import type { SortDir } from "@/shared/lib/tableSort";

export function useTableColumnSort<T extends string>(
  initialKey: T,
  initialDir: SortDir = "asc",
) {
  const [state, setState] = useState<{ key: T; dir: SortDir }>({
    key: initialKey,
    dir: initialDir,
  });

  const onSort = useCallback((next: string) => {
    setState((s) => {
      const nk = next as T;
      return s.key !== nk
        ? { key: nk, dir: "asc" }
        : { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" };
    });
  }, []);

  return { sortKey: state.key, sortDir: state.dir, onSort, setSort: setState };
}
