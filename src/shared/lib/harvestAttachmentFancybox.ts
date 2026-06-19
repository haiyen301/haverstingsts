import { Fancybox } from "@fancyapps/ui";

import {
  HARVEST_ATTACHMENT_SOURCES,
  getAttachmentUrls,
  getHarvestRowImageFieldValue,
} from "@/shared/lib/harvestAttachmentImages";

export type HarvestAttachmentSlide = { label: string; url: string };

/** All image URLs per harvest doc slot (for Fancybox gallery). */
export function buildHarvestAttachmentSlidesFromRow(
  r: Record<string, unknown>,
  labelByField?: Record<string, string>,
): HarvestAttachmentSlide[] {
  const slides: HarvestAttachmentSlide[] = [];
  for (const src of HARVEST_ATTACHMENT_SOURCES) {
    const label = labelByField?.[src.field] ?? src.label;
    const urls = getAttachmentUrls(getHarvestRowImageFieldValue(r, src.field));
    if (urls.length === 0) {
      slides.push({ label, url: "" });
      continue;
    }
    urls.forEach((url, idx) => {
      slides.push({
        label: urls.length > 1 ? `${label} (${idx + 1})` : label,
        url,
      });
    });
  }
  return slides;
}

export function openHarvestAttachmentFancybox(
  slides: HarvestAttachmentSlide[],
  slideIndex: number,
): void {
  const items = slides
    .filter((s) => s.url.trim())
    .map((s) => ({
      src: s.url,
      caption: s.label,
      type: "image" as const,
    }));
  if (items.length === 0) return;

  let startIndex = 0;
  for (let i = 0; i < slideIndex; i++) {
    if (slides[i]?.url.trim()) startIndex += 1;
  }
  if (!slides[slideIndex]?.url.trim()) {
    startIndex = 0;
  }

  Fancybox.show(items, {
    startIndex: Math.min(startIndex, items.length - 1),
    Carousel: { infinite: false },
    mainClass: "harvest-history-fancybox",
  });
}
