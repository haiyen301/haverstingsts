"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { useTheme } from "@/shared/theme/ThemeProvider";

/** Global toast host — call `toast.*` from any client component. */
export function AppToasts() {
  const { theme } = useTheme();
  return (
    <ToastContainer
      position="bottom-right"
      autoClose={4000}
      hideProgressBar={false}
      newestOnTop
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme={theme === "dark" ? "dark" : "light"}
      toastClassName="!rounded-lg !text-sm !shadow-lg"
    />
  );
}
