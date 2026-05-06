/**
 * Centralized static image URLs served from `public/assets/images`.
 * Keep app logos here so light/dark theme switching remains consistent.
 */
export const images = {
  stsLogo: "/assets/images/sts-logo.png",
  stsLogoDark: "/assets/images/sts-logo-dark.png",
  appLogoWhite: "/assets/images/app-logo-white.png",
} as const;

export type AppImageKey = keyof typeof images;

/** Public SVG paths for custom action icons (avoid hardcoded strings in pages). */
export const iconPaths = {
  edit: "/assets/images/edit-icon.svg",
  expand: "/assets/images/expand-icon.svg",
  collapse: "/assets/images/collapse-icon.svg",
} as const;
