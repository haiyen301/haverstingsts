"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { fetchSessionAuthenticated } from "@/shared/lib/sessionUser";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authed = await fetchSessionAuthenticated();
      if (cancelled) return;
      if (!authed) {
        const { clearAuthSession } = await import("@/shared/store/authUserStore");
        await clearAuthSession();
        setAuthed(false);
        router.replace("/");
        return;
      }
      setAuthed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authed === null) return null;
  if (!authed) return null;
  return <>{children}</>;
}

