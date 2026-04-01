"use client";

import { useTranslations } from "next-intl";

export function useAppTranslations(namespace?: string) {
  return useTranslations(namespace);
}
