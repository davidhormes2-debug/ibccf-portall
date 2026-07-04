const PROPERTY_ID = import.meta.env.VITE_TAWKTO_PROPERTY_ID as string | undefined;
const WIDGET_ID = import.meta.env.VITE_TAWKTO_WIDGET_ID as string | undefined;

let scriptLoaded = false;

export function isTawktoConfigured(): boolean {
  return !!(PROPERTY_ID && WIDGET_ID);
}

export function loadTawkto(): void {
  if (!PROPERTY_ID || !WIDGET_ID) return;
  if (scriptLoaded) return;
  scriptLoaded = true;

  const api = (window.Tawk_API = window.Tawk_API || {}) as any;
  (window as any).Tawk_LoadStart = new Date();

  const prevOnLoad = api.onLoad;
  api.onLoad = function () {
    if (typeof prevOnLoad === "function") prevOnLoad();
    window.__tawkLoaded = true;
    const path = window.location.pathname;
    if (path.toLowerCase().startsWith("/admin")) {
      api.hideWidget?.();
    }
  };

  const s1 = document.createElement("script");
  const s0 = document.getElementsByTagName("script")[0];
  s1.async = true;
  s1.src = `https://embed.tawk.to/${PROPERTY_ID}/${WIDGET_ID}`;
  s1.charset = "UTF-8";
  s1.setAttribute("crossorigin", "*");
  if (s0?.parentNode) {
    s0.parentNode.insertBefore(s1, s0);
  } else {
    document.head.appendChild(s1);
  }
}

export function showTawkto(): void {
  const api = window.Tawk_API as any;
  if (!api) return;
  api.showWidget?.();
  api.maximize?.();
}

export function hideTawkto(): void {
  const api = window.Tawk_API as any;
  if (!api) return;
  api.hideWidget?.();
}
