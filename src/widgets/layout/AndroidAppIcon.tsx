import { cn } from "@/lib/utils";

type AndroidAppIconProps = {
  className?: string;
};

/** Simple Android robot silhouette (not a trademarked color logo). */
export function AndroidAppIcon({ className }: AndroidAppIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path d="M17.6 9.48l1.84-3.18a.5.5 0 00-.87-.5l-1.88 3.24a7.02 7.02 0 00-5.59 0L9.22 5.8a.5.5 0 00-.87.5l1.84 3.18a6.97 6.97 0 00-3.47 5.99H21.07a6.97 6.97 0 00-3.47-5.99zM8.53 17.5a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0zm9.44 0a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0z" />
    </svg>
  );
}
