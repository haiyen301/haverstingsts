import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGet,
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type HelpContentType = "help" | "knowledge_base";

export type HelpCategoryRow = {
  id: number;
  title: string;
  description?: string | null;
  type?: HelpContentType;
  sort?: number | null;
  articles_order?: string | null;
  status?: string;
  total_articles?: number | null;
};

export type HelpArticleRow = {
  id: number;
  title: string;
  description?: string | null;
  category_id: number;
  category_title?: string | null;
  type?: HelpContentType;
  sort?: number | null;
  status?: string;
  total_views?: number | null;
  created_by?: number | null;
  created_at?: string | null;
};

export type HelpSuggestion = {
  value: number;
  label: string;
};

export type HelpCategorySavePayload = {
  id?: number;
  title: string;
  description?: string;
  type?: HelpContentType;
  sort?: number;
  articles_order?: string;
  status?: string;
};

export type HelpArticleSavePayload = {
  id?: number;
  title: string;
  description?: string;
  category_id: number;
  sort?: number;
  status?: string;
};

export async function fetchHelpCategories(
  type: HelpContentType = "help",
  admin = false,
): Promise<HelpCategoryRow[]> {
  if (admin) {
    return stsProxyGetWithParams<HelpCategoryRow[]>(STS_API_PATHS.helpCategories, { type });
  }
  return stsProxyGetWithParams<HelpCategoryRow[]>(STS_API_PATHS.help, { type });
}

export async function fetchHelpCategoryDetail(id: number): Promise<{
  category: HelpCategoryRow;
  articles: Pick<HelpArticleRow, "id" | "title">[];
}> {
  return stsProxyGetWithParams(STS_API_PATHS.helpCategory, { id });
}

export async function saveHelpCategory(
  payload: HelpCategorySavePayload,
): Promise<HelpCategoryRow> {
  return stsProxyPostJson<HelpCategoryRow>(STS_API_PATHS.helpSaveCategory, payload);
}

export async function removeHelpCategory(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.helpRemoveCategory, { id });
}

export async function fetchHelpArticles(params?: {
  type?: HelpContentType;
  category_id?: number;
}): Promise<HelpArticleRow[]> {
  return stsProxyGetWithParams<HelpArticleRow[]>(STS_API_PATHS.helpArticles, params);
}

export async function fetchHelpArticle(id: number): Promise<HelpArticleRow> {
  return stsProxyGetWithParams<HelpArticleRow>(STS_API_PATHS.helpArticle, { id });
}

export async function saveHelpArticle(
  payload: HelpArticleSavePayload,
): Promise<HelpArticleRow> {
  return stsProxyPostJson<HelpArticleRow>(STS_API_PATHS.helpSaveArticle, payload);
}

export async function removeHelpArticle(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.helpRemoveArticle, { id });
}

export async function fetchHelpSuggestions(
  search: string,
  type: HelpContentType = "help",
): Promise<HelpSuggestion[]> {
  return stsProxyGetWithParams<HelpSuggestion[]>(STS_API_PATHS.helpSuggestions, {
    search,
    type,
  });
}

export async function incrementHelpArticleView(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.helpIncrementView, { id });
}

export async function fetchCanManageHelp(): Promise<boolean> {
  const data = await stsProxyGet<{ can_manage: boolean }>(STS_API_PATHS.helpCanManage);
  return Boolean(data?.can_manage);
}
