import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import type { Role } from "@shared/schema";

export type AuthUser = User & { role: Role };

async function fetchUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function logout(): Promise<void> {
  window.location.href = "/api/logout";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  const role: Role = user?.role ?? 'viewer';

  return {
    user,
    role,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: role === 'admin',
    isManagement: role === 'admin' || role === 'management',
    // 2B governance roles
    isDestinationManager: role === 'destination_manager' || role === 'admin' || role === 'super_admin',
    isRoutingAdmin: role === 'routing_admin' || role === 'admin' || role === 'super_admin',
    // Approver ≠ Executor enforcement helpers
    canApproveFailover: role === 'destination_manager' || role === 'admin' || role === 'super_admin',
    canExecuteRouting: role === 'routing_admin' || role === 'admin' || role === 'super_admin',
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
