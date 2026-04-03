/**
 * "Remember me" chỉ lưu **email** trong localStorage để điền sẵn ô đăng nhập.
 * Mật khẩu không được lưu trên client (không localStorage/sessionStorage).
 */
const FLAG = "sts_remember_login";
const EMAIL = "sts_remember_email";
/** Legacy — xóa khi load; trước đây lưu plaintext (không an toàn). */
const LEGACY_PASSWORD = "sts_remember_password";

function purgeLegacyPasswordKey() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_PASSWORD);
  } catch {
    /* ignore */
  }
}

purgeLegacyPasswordKey();

export function loadRememberedCredentials(): { email: string } | null {
  if (typeof window === "undefined") return null;
  if (window.localStorage.getItem(FLAG) !== "1") return null;
  const email = window.localStorage.getItem(EMAIL) ?? "";
  if (!email.trim()) return null;
  return { email };
}

export function saveRememberedCredentials(email: string) {
  if (typeof window === "undefined") return;
  const trimmed = email.trim();
  if (!trimmed) {
    clearRememberedCredentials();
    return;
  }
  window.localStorage.setItem(FLAG, "1");
  window.localStorage.setItem(EMAIL, trimmed);
}

export function clearRememberedCredentials() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FLAG);
  window.localStorage.removeItem(EMAIL);
  window.localStorage.removeItem(LEGACY_PASSWORD);
}
