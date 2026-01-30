import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

export function useCalls(limit?: number) {
  return useQuery({
    queryKey: [api.calls.list.path, limit],
    queryFn: async () => {
      const url = limit 
        ? `${api.calls.list.path}?limit=${limit}` 
        : api.calls.list.path;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch calls");
      return api.calls.list.responses[200].parse(await res.json());
    },
    refetchInterval: 5000,
  });
}

export function useCall(id: number) {
  return useQuery({
    queryKey: [api.calls.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.calls.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch call details");
      return api.calls.get.responses[200].parse(await res.json());
    },
  });
}

export function useCallMetrics(id: number) {
  return useQuery({
    queryKey: [api.calls.metrics.path, id],
    queryFn: async () => {
      const url = buildUrl(api.calls.metrics.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch call metrics");
      return api.calls.metrics.responses[200].parse(await res.json());
    },
    refetchInterval: 2000, // Faster update for metrics graph
  });
}
