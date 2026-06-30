"use client";

import type { Editor } from "@tiptap/react";
import {
  Columns2,
  Rows2,
  Table2,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";

function TableAction({
  title,
  disabled,
  onClick,
  children,
  destructive,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded border border-transparent px-2 text-xs font-medium transition-colors hover:bg-background disabled:opacity-40",
        destructive && "text-destructive hover:bg-destructive/10",
      )}
    >
      {children}
    </button>
  );
}

type TiptapTableToolbarProps = {
  editor: Editor;
};

export function TiptapTableToolbar({ editor }: TiptapTableToolbarProps) {
  if (!editor.isActive("table")) return null;

  const chain = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-input/60 bg-primary/5 px-2 py-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <Table2 className="h-3.5 w-3.5" />
        Table
      </span>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <TableAction
        title="Add row above"
        onClick={() => chain().addRowBefore().run()}
        disabled={!editor.can().addRowBefore()}
      >
        <Rows2 className="h-3.5 w-3.5" />
        Row ↑
      </TableAction>
      <TableAction
        title="Add row below"
        onClick={() => chain().addRowAfter().run()}
        disabled={!editor.can().addRowAfter()}
      >
        <Rows2 className="h-3.5 w-3.5" />
        Row ↓
      </TableAction>
      <TableAction
        title="Delete row"
        destructive
        onClick={() => chain().deleteRow().run()}
        disabled={!editor.can().deleteRow()}
      >
        Del row
      </TableAction>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <TableAction
        title="Add column left"
        onClick={() => chain().addColumnBefore().run()}
        disabled={!editor.can().addColumnBefore()}
      >
        <Columns2 className="h-3.5 w-3.5" />
        Col ←
      </TableAction>
      <TableAction
        title="Add column right"
        onClick={() => chain().addColumnAfter().run()}
        disabled={!editor.can().addColumnAfter()}
      >
        <Columns2 className="h-3.5 w-3.5" />
        Col →
      </TableAction>
      <TableAction
        title="Delete column"
        destructive
        onClick={() => chain().deleteColumn().run()}
        disabled={!editor.can().deleteColumn()}
      >
        Del col
      </TableAction>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <TableAction
        title="Toggle header row"
        onClick={() => chain().toggleHeaderRow().run()}
        disabled={!editor.can().toggleHeaderRow()}
      >
        Header
      </TableAction>
      <TableAction
        title="Merge or split cells"
        onClick={() => chain().mergeOrSplit().run()}
        disabled={!editor.can().mergeOrSplit()}
      >
        Merge
      </TableAction>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <TableAction
        title="Delete entire table"
        destructive
        onClick={() => chain().deleteTable().run()}
        disabled={!editor.can().deleteTable()}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete table
      </TableAction>
    </div>
  );
}
