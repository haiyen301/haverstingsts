"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/shared/lib/tableSort";

type Props = {
  label: React.ReactNode;
  columnKey: string;
  activeKey: string;
  direction: SortDir;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right";
};

export function SortableTh({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  className = "",
  align = "left",
}: Props) {
  const active = activeKey === columnKey;
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} ${className}`}
      scope="col"
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ${
          align === "right" ? "w-full justify-end" : ""
        }`}
      >
        <span>{label}</span>
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}
