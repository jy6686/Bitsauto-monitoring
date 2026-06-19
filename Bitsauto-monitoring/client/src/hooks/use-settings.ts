import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type UpdateSettingsRequest } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useSettings() {
  return useQuery({
    queryKey: [api.settings.get.path],
    queryFn: async () => {
      const res = await fetch(api.settings.get.path);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return api.settings.get.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: UpdateSettingsRequest) => {
      const res = await fetch(api.settings.update.path, {
        method: api.settings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return api.settings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
      toast({
        title: "Settings Updated",
        description: "Monitoring thresholds have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update settings.",
        variant: "destructive",
      });
    },
  });
}

export function useResetSimulation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.settings.resetSimulation.path, {
        method: api.settings.resetSimulation.method,
      });
      if (!res.ok) throw new Error("Failed to reset simulation");
      return api.settings.resetSimulation.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries(); // Invalidate everything to clear old data
      toast({
        title: "Simulation Reset",
        description: "All monitoring data has been cleared and simulation restarted.",
      });
    },
  });
}
