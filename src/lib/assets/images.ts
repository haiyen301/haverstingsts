import type { StaticImageData } from "next/image";

import appLogoWhite from "@/assets/images/app-logo-white.png";
import stsLogo from "@/assets/images/sts-logo.png";

/**
 * Tập trung mọi ảnh tĩnh: import `images` (hoặc từng biến) rồi dùng với `next/image` / `<img />`.
 * Thêm file mới: import ở đây rồi bổ sung key trong `images`.
 */
export const images = {
  stsLogo,
  appLogoWhite,
} as const satisfies Record<string, StaticImageData>;

export type AppImageKey = keyof typeof images;

/** Public SVG paths for custom action icons (avoid hardcoded strings in pages). */
export const iconPaths = {
  edit: "/assets/images/edit-icon.svg",
  expand: "/assets/images/expand-icon.svg",
  collapse: "/assets/images/collapse-icon.svg",
} as const;
