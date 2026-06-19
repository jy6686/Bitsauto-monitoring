import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrgRole } from "@shared/schema";

export interface OrgScope {
  kamId:             number | null;
  orgRole:           OrgRole | null;   // null = admin / full access
  kamName:           string | null;
  visibleAccountIds: string[];         // empty = see everything (HOD / no KAM record)
  isLoading:         boolean;
  isScoped:          boolean;          // true when this user has a restricted org role
}

const OrgScopeContext = createContext<OrgScope>({
  kamId:             null,
  orgRole:           null,
  kamName:           null,
  visibleAccountIds: [],
  isLoading:         false,
  isScoped:          false,
});

export function OrgScopeProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<{
    kamId:             number | null;
    orgRole:           OrgRole | null;
    kamName:           string | null;
    visibleAccountIds: string[];
  }>({
    queryKey: ['/api/org/my-scope'],
    staleTime: 60_000,
    retry: false,
  });

  const scope: OrgScope = {
    kamId:             data?.kamId             ?? null,
    orgRole:           data?.orgRole           ?? null,
    kamName:           data?.kamName           ?? null,
    visibleAccountIds: data?.visibleAccountIds ?? [],
    isLoading,
    isScoped: !isLoading && data?.orgRole != null && data.orgRole !== 'HOD',
  };

  return (
    <OrgScopeContext.Provider value={scope}>
      {children}
    </OrgScopeContext.Provider>
  );
}

export function useOrgScope(): OrgScope {
  return useContext(OrgScopeContext);
}
