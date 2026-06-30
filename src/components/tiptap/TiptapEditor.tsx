"use client";

/**
 * Tiptap editor for Next.js — follows official setup:
 * https://tiptap.dev/docs/editor/getting-started/install/nextjs
 *
 * - `'use client'` + `useEditor` + `EditorContent`
 * - `immediatelyRender: false` avoids SSR hydration mismatch
 * - Styles scoped via `.tiptap` (see `./tiptap.css`)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";

import { createTiptapExtensions } from "@/components/tiptap/extensions";
import { TiptapToolbar } from "@/components/tiptap/TiptapToolbar";
import { cn } from "@/lib/utils";

import "./tiptap.css";

export type TiptapEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
};

export function TiptapEditor({
  value,
  onChange,
  placeholder = "Write content…",
  className,
  minHeight = 280,
}: TiptapEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [codeView, setCodeView] = useState(false);
  const [codeHtml, setCodeHtml] = useState(value);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const contentHeight = minHeight;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createTiptapExtensions(placeholder),
    content: value || "",
    onUpdate: ({ editor: ed }) => {
      if (syncingRef.current) return;
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "tiptap prose prose-sm max-w-none bg-white px-4 py-3 focus:outline-none dark:prose-invert",
        style: "--default-cell-min-width: 6rem;",
      },
      scrollThreshold: { top: 64, right: 64, bottom: 64, left: 64 },
      scrollMargin: { top: 32, right: 32, bottom: 32, left: 32 },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const scrollSelectionIntoView = () => {
      const container = contentScrollRef.current;
      const view = editor.view;
      if (!container || !view) return;

      const { from } = view.state.selection;
      const coords = view.coordsAtPos(from);
      const containerRect = container.getBoundingClientRect();
      const margin = 32;

      if (coords.bottom > containerRect.bottom - margin) {
        container.scrollTop += coords.bottom - containerRect.bottom + margin;
      }
      if (coords.top < containerRect.top + margin) {
        container.scrollTop -= containerRect.top + margin - coords.top;
      }
    };

    editor.on("selectionUpdate", scrollSelectionIntoView);
    editor.on("update", scrollSelectionIntoView);
    return () => {
      editor.off("selectionUpdate", scrollSelectionIntoView);
      editor.off("update", scrollSelectionIntoView);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      syncingRef.current = true;
      editor.commands.setContent(value || "", { emitUpdate: false });
      syncingRef.current = false;
    }
  }, [editor, value]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const insertImage = useCallback(
    (src: string) => {
      if (!editor || !src.trim()) return;
      editor.chain().focus().setImage({ src: src.trim() }).run();
    },
    [editor],
  );

  const toggleCodeView = useCallback(() => {
    if (!editor) return;
    if (!codeView) {
      setCodeHtml(editor.getHTML());
      setCodeView(true);
      return;
    }
    editor.commands.setContent(codeHtml, { emitUpdate: false });
    onChange(codeHtml);
    setCodeView(false);
  }, [codeView, codeHtml, editor, onChange]);

  if (!editor) {
    return (
      <div
        className={cn(
          "rounded-lg border border-input bg-muted/20",
          className,
        )}
        style={{ minHeight }}
      />
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-input bg-background shadow-sm",
        fullscreen && "fixed inset-3 z-[80] flex flex-col bg-background shadow-2xl",
        className,
      )}
    >
      <TiptapToolbar
        editor={editor}
        codeView={codeView}
        fullscreen={fullscreen}
        onToggleCodeView={toggleCodeView}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        onPickImage={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") insertImage(reader.result);
          };
          reader.readAsDataURL(file);
          e.target.value = "";
        }}
      />

      {codeView ? (
        <textarea
          value={codeHtml}
          onChange={(e) => {
            setCodeHtml(e.target.value);
            onChange(e.target.value);
          }}
          className="w-full flex-1 resize-none border-0 bg-white p-4 font-mono text-sm text-foreground focus:outline-none"
          style={{ height: fullscreen ? undefined : contentHeight }}
        />
      ) : (
        <div
          ref={contentScrollRef}
          className={cn(
            "overflow-y-auto bg-white",
            fullscreen && "min-h-0 flex-1",
          )}
          style={fullscreen ? undefined : { height: contentHeight }}
        >
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}
