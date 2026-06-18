"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { useTheme } from "@/shared/theme/ThemeProvider";

const TOAST_CLASS = "!rounded-lg !text-sm !shadow-lg";

/** Top-right container — forecast rebuild / important admin notices. */
export const TOAST_CONTAINER_TOP_RIGHT = "top-right";

/** Global toast host — call `toast.*` from any client component. */
export function AppToasts() {
  const { theme } = useTheme();
  const themeProp = theme === "dark" ? "dark" : "light";

  return (
    <>
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
        theme={themeProp}
        toastClassName={TOAST_CLASS}
        style={{ zIndex: 9999 }}
      />
      <ToastContainer
        containerId={TOAST_CONTAINER_TOP_RIGHT}
        position="top-right"
        autoClose={10000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme={themeProp}
        toastClassName={TOAST_CLASS}
        style={{ zIndex: 10000 }}
      />
    </>
  );
}
