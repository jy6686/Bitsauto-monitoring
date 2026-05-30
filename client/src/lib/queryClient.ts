import { QueryClient, QueryFunction } from "@tanstack/react-query";

function handleSessionExpired() {
  const isLoginPage = window.location.pathname === "/login" ||
                      window.location.pathname === "/api/login";
  if (!isLoginPage) {
    sessionStorage.setItem("session_expired", "1");
    window.location.href = "/api/login";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let text: string;
    try {
      text = await res.text();
    } catch {
      text = res.statusText;
    }

    if (res.status === 401) {
      let body: any = {};
      try { body = JSON.parse(text); } catch { /* ignore */ }
      if (body?.code === "IDLE_TIMEOUT") {
        handleSessionExpired();
        throw new Error("Your session expired due to inactivity. Redirecting to sign in…");
      }
      handleSessionExpired();
      throw new Error("Session expired. Redirecting to sign in…");
    }

    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 401) {
      let body: any = {};
      try { body = await res.clone().json(); } catch { /* ignore */ }
      if (body?.code === "IDLE_TIMEOUT") {
        handleSessionExpired();
        throw new Error("Your session expired due to inactivity.");
      }
      handleSessionExpired();
      throw new Error("Session expired.");
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
