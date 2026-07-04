import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Initialise i18next before the React tree mounts so the very first render
// sees the persisted/auto-detected locale instead of flashing English.
import "./i18n";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

// Register the PWA service worker so users can install IBCCF as an app on
// their phones. The SW lives at /sw.js (in client/public). We only register
// in production-like environments; during local dev with HMR, the SW caches
// can mask updates.
if (
  "serviceWorker" in navigator &&
  (import.meta.env.PROD || import.meta.env.MODE !== "development")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => {
        // Don't break the app if SW fails to register.
        console.warn("[pwa] service worker registration failed", err);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
