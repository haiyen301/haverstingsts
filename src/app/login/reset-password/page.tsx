import { Suspense } from "react";

import ResetPasswordForm from "@/features/auth/ui/ResetPasswordForm";

export default function LoginResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
