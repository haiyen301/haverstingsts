"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Local SVG flags: original colors. Active = full color; inactive = grayscale on the SVG.
 */

function remapSvgIds(svg: Element, suffix: string): void {
  const elements = [...svg.querySelectorAll("[id]")] as Element[];
  const oldToNew = new Map<string, string>();
  elements.forEach((el) => {
    const old = el.getAttribute("id");
    if (old) oldToNew.set(old, `${old}-${suffix}`);
  });
  elements.forEach((el) => {
    const old = el.getAttribute("id");
    if (old && oldToNew.has(old)) el.setAttribute("id", oldToNew.get(old)!);
  });

  function patchRefs(el: Element): void {
    for (const attr of [...el.attributes]) {
      let val = attr.value;
      oldToNew.forEach((newId, oldId) => {
        val = val.split(`url(#${oldId})`).join(`url(#${newId})`);
      });
      if (val !== attr.value) el.setAttribute(attr.name, val);
    }
    [...el.children].forEach(patchRefs);
  }
  patchRefs(svg);
}

function stripScripts(svg: Element): void {
  svg.querySelectorAll("script").forEach((n) => n.remove());
}

export function FarmCountryFlag({
  countryCode,
  flagEmoji,
  active,
}: {
  countryCode: string;
  flagEmoji: string;
  active: boolean;
}) {
  const code = useMemo(
    () => countryCode.trim().toUpperCase().replace(/^UK$/, "GB"),
    [countryCode],
  );
  const showSvg = /^[A-Z]{2}$/.test(code);
  const idSuffix = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!showSvg) return;
    let cancelled = false;
    setSvgMarkup(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(`/flags/${code.toLowerCase()}.svg`);
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        if (cancelled) return;
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        const svg = doc.documentElement;
        if (svg.querySelector("parsererror") || svg.tagName.toLowerCase() !== "svg") {
          throw new Error("parse");
        }
        stripScripts(svg);
        remapSvgIds(svg, idSuffix);
        svg.setAttribute("width", "28");
        svg.setAttribute("height", "21");
        svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
        svg.style.display = "block";
        const out = new XMLSerializer().serializeToString(svg);
        setSvgMarkup(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, idSuffix, showSvg]);

  if (!showSvg) {
    return (
      <span
        className={cn(
          "inline-block text-lg leading-none transition-[filter,opacity] duration-200",
          active ? "grayscale-0 opacity-100" : "grayscale opacity-[0.42]",
        )}
        aria-hidden
      >
        {flagEmoji}
      </span>
    );
  }

  if (failed) {
    return (
      <span
        className="inline-flex h-[21px] w-7 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white text-[10px] text-gray-400"
        aria-hidden
      >
        ?
      </span>
    );
  }

  if (!svgMarkup) {
    return (
      <span className="inline-flex h-[21px] w-7 shrink-0 overflow-hidden rounded-md bg-white" aria-hidden>
        <img
          src={`/flags/${code.toLowerCase()}.svg`}
          alt=""
          width={28}
          height={21}
          className="h-[21px] w-7 object-cover opacity-50 grayscale"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-[21px] w-7 shrink-0 overflow-hidden rounded-md bg-white",
        "transition-[filter] duration-200",
        "[&>svg]:block [&>svg]:h-full [&>svg]:w-full",
        !active && "[&>svg]:grayscale [&>svg]:opacity-[0.55]",
      )}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
