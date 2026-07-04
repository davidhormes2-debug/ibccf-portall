import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { STORAGE_KEY as LOCALE_STORAGE_KEY, DEFAULT_LOCALE } from "@/i18n";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Read the user's chosen locale from localStorage (set by i18next-browser-
// languagedetector via `useLocale.setLocale`). Send it as `X-User-Locale`
// on every API request so the server can render transactional emails and
// other server-generated copy in the user's language. Falls back silently
// to English if storage is unavailable.
function currentLocaleHeader(): Record<string, string> {
  try {
    const value = typeof localStorage !== "undefined" && localStorage.getItem(LOCALE_STORAGE_KEY);
    return { "X-User-Locale": value || DEFAULT_LOCALE };
  } catch {
    return { "X-User-Locale": DEFAULT_LOCALE };
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...currentLocaleHeader(),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: currentLocaleHeader(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
