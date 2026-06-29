export type ItemCategoryNode = {
  id: number;
  title: string;
  parent_id?: number | null;
  path?: string | null;
};

/** Build PRODUCTS/MACHINERY/SPARE PART style path from parent_id chain. */
export function buildItemCategoryPath(
  categoryId: number,
  categories: ItemCategoryNode[],
): string {
  if (!Number.isFinite(categoryId) || categoryId <= 0 || categories.length === 0) {
    return "";
  }

  const map = new Map<number, ItemCategoryNode>();
  for (const cat of categories) {
    const id = Number(cat.id);
    if (Number.isFinite(id) && id > 0) {
      map.set(id, cat);
    }
  }

  const parts: string[] = [];
  const visited = new Set<number>();
  let current = map.get(categoryId);

  while (current) {
    const id = Number(current.id);
    if (visited.has(id)) break;
    visited.add(id);

    const title = String(current.title ?? "").trim();
    if (title) parts.unshift(title);

    const parentId = Number(current.parent_id ?? 0);
    if (!Number.isFinite(parentId) || parentId <= 0) break;
    current = map.get(parentId);
  }

  return parts.join("/");
}

export function itemCategoryDisplayPath(
  category: ItemCategoryNode,
  categories: ItemCategoryNode[],
): string {
  const fromApi = String(category.path ?? "").trim();
  if (fromApi) return fromApi;
  const built = buildItemCategoryPath(Number(category.id), categories);
  if (built) return built;
  return String(category.title ?? "").trim();
}

export function sortItemCategoriesByPath(
  categories: ItemCategoryNode[],
): ItemCategoryNode[] {
  return [...categories].sort((a, b) =>
    itemCategoryDisplayPath(a, categories).localeCompare(
      itemCategoryDisplayPath(b, categories),
    ),
  );
}
