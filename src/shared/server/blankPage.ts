import { redirect } from "next/navigation";

/**
 * Server-side helper to route users to a reusable blank page.
 * Usage mirrors `notFound()` style intent at call sites.
 */
export function blankPage(): never {
  redirect("/blank");
}
