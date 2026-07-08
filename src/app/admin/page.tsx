import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { hasModulePermission } from "@/shared/auth/permissions";
import { AUTH_COOKIE_NAME } from "@/shared/lib/authCookie";
import { fetchTrustedAclByToken } from "@/shared/server/trustedAcl";

export default async function AdminPage() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (!token) {
    redirect("/");
  }

  const acl = await fetchTrustedAclByToken(token);
  if (!acl) {
    notFound();
  }

  const targets: Array<{ module: string; path: string }> = [
    { module: "admin_people", path: "/admin/people" },
    { module: "admin_roles", path: "/admin/roles" },
    { module: "admin_project_types", path: "/admin/projectTypes" },
    { module: "admin_architects", path: "/admin/architects" },
    { module: "admin_farms", path: "/admin/farms" },
    { module: "admin_machinery_types", path: "/admin/fleet/machinery-types" },
    { module: "admin_zones", path: "/admin/zones" },
    { module: "admin_regrowth", path: "/admin/regrowth" },
    { module: "admin_grasses", path: "/admin/grasses" },
    { module: "admin_key_areas", path: "/admin/keyareas" },
    { module: "admin_fertilizer_product", path: "/admin/fertilizer-product" },
    { module: "admin_project_paces", path: "/admin/project-paces" },
    { module: "admin_countries", path: "/admin/settings/countries" },
    // TODO: tạm ẩn — chưa dùng
    // { module: "admin_items", path: "/admin/settings/items" },
    { module: "admin_item_categories", path: "/admin/settings/item-categories" },
    { module: "admin_brands", path: "/admin/settings/brands" },
    { module: "admin_units", path: "/admin/settings/unit-types" },
  ];

  const firstAllowed = targets.find((target) =>
    hasModulePermission(target.module, acl?.permissions ?? {}, "show", acl?.is_admin),
  );
  if (!firstAllowed) {
    notFound();
  }
  redirect(firstAllowed.path);
}
