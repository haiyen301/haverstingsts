"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LoginForm from "@/features/auth/ui/LoginForm";
import { fetchSessionAuthenticated } from "@/shared/lib/sessionUser";

/** `/` → đã đăng nhập: vào dashboard; chưa đăng nhập: màn hình đăng nhập. */
export default function HomePage() {
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authed = await fetchSessionAuthenticated();
      if (cancelled) return;
      if (authed) {
        router.replace("/dashboard");
        return;
      }
      const { clearAuthSession } = await import("@/shared/store/authUserStore");
      await clearAuthSession();
      setShowLogin(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!showLogin) return null;

  return <LoginForm />;
}
