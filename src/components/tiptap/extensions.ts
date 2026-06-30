import { Color } from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Youtube from "@tiptap/extension-youtube";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/react";

import { handleTableBackspace } from "@/components/tiptap/tableKeyboard";

const HelpTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: ({ editor }) => handleTableBackspace(editor),
      "Mod-Backspace": ({ editor }) => handleTableBackspace(editor),
    };
  },
});

/** Shared Tiptap extension bundle for help / knowledge-base editors. */
export function createTiptapExtensions(placeholder = "Write content…"): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
    }),
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Link.configure({ openOnClick: false, autolink: true }),
    Image.configure({ inline: false, allowBase64: true }),
    Youtube.configure({ width: 640, height: 360 }),
    HelpTable.configure({
      resizable: true,
      HTMLAttributes: { class: "help-editor-table" },
    }),
    TableRow,
    TableHeader.configure({
      HTMLAttributes: { class: "help-editor-table-header" },
    }),
    TableCell.configure({
      HTMLAttributes: { class: "help-editor-table-cell" },
    }),
    HorizontalRule,
    Placeholder.configure({ placeholder }),
  ];
}

export const TIPTAP_FONT_FAMILIES = [
  { label: "Plus Jakarta Sans", value: "Plus Jakarta Sans, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "Times New Roman, serif" },
  { label: "Courier New", value: "Courier New, monospace" },
] as const;

export const TIPTAP_TEXT_COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#1f7a4c",
  "#0b5394",
  "#990000",
  "#e69138",
  "#6aa84f",
] as const;

export const TIPTAP_HIGHLIGHT_COLORS = [
  "#ffff00",
  "#fce5cd",
  "#d9ead3",
  "#cfe2f3",
  "#ead1dc",
] as const;
