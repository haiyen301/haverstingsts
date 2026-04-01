/**
 * "Remember me" stores email + password in localStorage (convenient but not for shared devices).
 */
const FLAG = "sts_remember_login";
const EMAIL = "sts_remember_email";
const PASSWORD = "sts_remember_password";

export function loadRememberedCredentials(): {
  email: string;
  password: string;
} | null {
  if (typeof window === "undefined") return null;
  if (window.localStorage.getItem(FLAG) !== "1") return null;
  return {
    email: window.localStorage.getItem(EMAIL) ?? "",
    password: window.localStorage.getItem(PASSWORD) ?? "",
  };
}

export function saveRememberedCredentials(email: string, password: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FLAG, "1");
  window.localStorage.setItem(EMAIL, email);
  window.localStorage.setItem(PASSWORD, password);
}

export function clearRememberedCredentials() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FLAG);
  window.localStorage.removeItem(EMAIL);
  window.localStorage.removeItem(PASSWORD);
}
