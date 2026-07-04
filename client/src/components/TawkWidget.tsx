import { useEffect } from "react";
import { useLocation } from "wouter";
import { loadTawkto, hideTawkto, showTawkto } from "@/lib/tawkto";

declare global {
  interface Window {
    Tawk_API?: Record<string, any>;
    __tawkLoaded?: boolean;
  }
}

export function TawkWidget() {
  const [location] = useLocation();
  const isAdmin = location.toLowerCase().startsWith("/admin");

  useEffect(() => {
    loadTawkto();
  }, []);

  useEffect(() => {
    const toggle = () => {
      if (isAdmin) {
        hideTawkto();
      } else {
        showTawkto();
      }
    };

    if (window.__tawkLoaded) {
      toggle();
    } else {
      const api = window.Tawk_API;
      if (api) {
        const prevOnLoad = api.onLoad as (() => void) | undefined;
        api.onLoad = () => {
          prevOnLoad?.();
          toggle();
        };
      }
    }
  }, [isAdmin]);

  return null;
}
