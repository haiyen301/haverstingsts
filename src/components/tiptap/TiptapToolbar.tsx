"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code2,
  Eraser,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Video,
} from "lucide-react";

import {
  TIPTAP_FONT_FAMILIES,
  TIPTAP_HIGHLIGHT_COLORS,
  TIPTAP_TEXT_COLORS,
} from "@/components/tiptap/extensions";
import { TiptapTableToolbar } from "@/components/tiptap/TiptapTableToolbar";
import { cn } from "@/lib/utils";

function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded border border-transparent px-1.5 text-foreground transition-colors hover:bg-muted disabled:opacity-40",
        active && "border-input bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarSelect({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-full appearance-none truncate rounded border border-input bg-background pl-2 pr-7 text-xs text-foreground"
      >
        {options.map((opt) => (
          <option key={opt.value || opt.label} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function ColorPalette({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-input bg-popover p-2 shadow-md">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Text
      </p>
      <div className="mb-2 grid grid-cols-4 gap-1">
        {TIPTAP_TEXT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            className="h-6 w-full rounded border border-border"
            style={{ backgroundColor: color }}
            onClick={() => {
              editor.chain().focus().setColor(color).run();
              onClose();
            }}
          />
        ))}
      </div>
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Highlight
      </p>
      <div className="grid grid-cols-4 gap-1">
        {TIPTAP_HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            className="h-6 w-full rounded border border-border"
            style={{ backgroundColor: color }}
            onClick={() => {
              editor.chain().focus().toggleHighlight({ color }).run();
              onClose();
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="mt-2 w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => {
          editor.chain().focus().unsetColor().unsetHighlight().run();
          onClose();
        }}
      >
        Clear color
      </button>
    </div>
  );
}

type TiptapToolbarProps = {
  editor: Editor;
  codeView: boolean;
  fullscreen: boolean;
  onToggleCodeView: () => void;
  onToggleFullscreen: () => void;
  onPickImage: () => void;
};

export function TiptapToolbar({
  editor,
  codeView,
  fullscreen,
  onToggleCodeView,
  onToggleFullscreen,
  onPickImage,
}: TiptapToolbarProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const [, setToolbarTick] = useState(0);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setToolbarTick((n) => n + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  useEffect(() => {
    if (!colorOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setColorOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [colorOpen]);

  const currentFont =
    TIPTAP_FONT_FAMILIES.find((f) => editor.isActive("textStyle", { fontFamily: f.value }))
      ?.value ?? "Plus Jakarta Sans, sans-serif";

  const applyStylePreset = (preset: string) => {
    if (preset === "paragraph") editor.chain().focus().setParagraph().run();
    if (preset === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
    if (preset === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
    if (preset === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
    if (preset === "blockquote") editor.chain().focus().toggleBlockquote().run();
  };

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertVideo = () => {
    const url = window.prompt("YouTube URL");
    if (!url) return;
    editor.commands.setYoutubeVideo({ src: url });
  };

  const rowClass = "flex flex-wrap items-center gap-0.5";

  return (
    <div className="border-b border-input bg-muted/30">
      <TiptapTableToolbar editor={editor} />

      {/* Row 1 — formatting */}
      <div className={cn(rowClass, "border-b border-input/60 p-1.5")}>
        <ToolbarSelect
          ariaLabel="Text style"
          value=""
          onChange={applyStylePreset}
          options={[
            { label: "Style", value: "" },
            { label: "Paragraph", value: "paragraph" },
            { label: "Heading 1", value: "h1" },
            { label: "Heading 2", value: "h2" },
            { label: "Heading 3", value: "h3" },
            { label: "Quote", value: "blockquote" },
          ]}
          className="w-[108px]"
        />

        <span className="mx-0.5 h-6 w-px bg-border" />

        <ToolbarButton
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Clear formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        >
          <Eraser className="h-4 w-4" />
        </ToolbarButton>

        <span className="mx-0.5 h-6 w-px bg-border" />

        <ToolbarSelect
          ariaLabel="Font family"
          value={currentFont}
          onChange={(font) => editor.chain().focus().setFontFamily(font).run()}
          options={[...TIPTAP_FONT_FAMILIES]}
          className="w-[148px]"
        />

        <div className="relative" ref={colorRef}>
          <button
            type="button"
            title="Text color / highlight"
            aria-expanded={colorOpen}
            onClick={() => setColorOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded border border-input bg-background px-2 text-xs hover:bg-muted"
          >
            <span className="font-semibold text-foreground">A</span>
            <span className="h-1 w-4 rounded-sm bg-yellow-300" />
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {colorOpen ? <ColorPalette editor={editor} onClose={() => setColorOpen(false)} /> : null}
        </div>

        <span className="mx-0.5 h-6 w-px bg-border" />

        <ToolbarButton
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarSelect
          ariaLabel="Text alignment"
          value=""
          onChange={(align) => {
            if (!align) return;
            editor.chain().focus().setTextAlign(align as "left" | "center" | "right" | "justify").run();
          }}
          options={[
            { label: "Align", value: "" },
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Right", value: "right" },
            { label: "Justify", value: "justify" },
          ]}
          className="w-[84px]"
        />

        <ToolbarSelect
          ariaLabel="Heading level"
          value=""
          onChange={(level) => {
            if (!level) return;
            editor.chain().focus().toggleHeading({ level: Number(level) as 1 | 2 | 3 | 4 }).run();
          }}
          options={[
            { label: "Heading", value: "" },
            { label: "H1", value: "1" },
            { label: "H2", value: "2" },
            { label: "H3", value: "3" },
            { label: "H4", value: "4" },
          ]}
          className="w-[92px]"
        />

        <ToolbarButton
          title="Insert table"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <Table2 className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Row 2 — insert / view */}
      <div className={cn(rowClass, "p-1.5")}>
        <ToolbarButton title="Link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Image" onClick={onPickImage}>
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Video" onClick={insertVideo}>
          <Video className="h-4 w-4" />
        </ToolbarButton>

        <span className="mx-0.5 h-6 w-px bg-border" />

        <ToolbarButton
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ToolbarButton>
        <ToolbarButton title="HTML source" active={codeView} onClick={onToggleCodeView}>
          <Code2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}
