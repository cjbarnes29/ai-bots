import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./App";
import { SessionGate } from "./components/SessionGate";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();

const queryClient = new QueryClient({
  // Every 15 seconds (while the page is open) and whenever you come back to it, the screen re-reads the server, so a change
  // made on the phone shows on the PC and the other way round.
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, refetchInterval: 15_000, refetchIntervalInBackground: false } },
});
const router = createBrowserRouter(routes);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
    </QueryClientProvider>
  </StrictMode>,
);

// Installable app support. Only in the built version (a service worker would only get in the way while developing).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
