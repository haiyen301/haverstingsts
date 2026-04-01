"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { STORAGE_TOKEN_KEY } from "@/shared/lib/sessionUser";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem(STORAGE_TOKEN_KEY);
    if (!token) {
      setAuthed(false);
      router.replace("/");
      return;
    }
    setAuthed(true);
  }, [router]);

  if (authed === null) return null;
  if (!authed) return null;
  return <>{children}</>;
}

