"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LoginForm from "@/features/auth/ui/LoginForm";
import { STORAGE_TOKEN_KEY } from "@/shared/lib/sessionUser";

/** `/` → đã đăng nhập: vào dashboard; chưa đăng nhập: màn hình đăng nhập. */
export default function HomePage() {
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem(STORAGE_TOKEN_KEY);
    if (token) {
      router.replace("/dashboard");
      return;
    }
    setShowLogin(true);
  }, [router]);

  if (!showLogin) return null;

  return <LoginForm />;
}
