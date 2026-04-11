import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutShell } from "@/components/layout-shell";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import type { Role } from "@shared/schema";

import DashboardPage from "@/pages/dashboard";
import CallsListPage from "@/pages/calls-list";
import CallDetailPage from "@/pages/call-detail";
import AlertsPage from "@/pages/alerts";
import SettingsPage from "@/pages/settings";
import ReportsPage from "@/pages/reports";
import TeamPage from "@/pages/team";
import ClientsPage from "@/pages/clients";
import FraudPage from "@/pages/fraud";
import CDRsPage from "@/pages/cdrs";
import ToolsPage from "@/pages/tools";
import AccountPage from "@/pages/account";
import LoginPage from "@/pages/login";
import TrafficMapPage from "@/pages/traffic-map";
import BalanceMonitorPage from "@/pages/balance-monitor";
import DIDsPage from "@/pages/dids";
import ServerMonitoringPage from "@/pages/server-monitoring";
import GraphsPage from "@/pages/graphs";
import NotFound from "@/pages/not-found";

// Pages accessible to each role
const ROLE_PATHS: Record<Role, string[]> = {
  admin:      ['/', '/calls', '/alerts', '/reports', '/settings', '/team'],
  management: ['/', '/calls', '/alerts', '/reports'],
  viewer:     ['/', '/calls'],
};

function ProtectedRoute({
  component: Component,
  requiredRoles,
}: {
  component: React.ComponentType<any>;
  requiredRoles?: Role[];
}) {
  const { user, role, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  // Role-based access check
  if (requiredRoles && !requiredRoles.includes(role)) {
    return (
      <LayoutShell>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
          <ShieldOff className="w-14 h-14 text-muted-foreground/30" />
          <h2 className="text-2xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground max-w-sm">
            Your <span className="font-semibold capitalize">{role}</span> role does not have permission to view this page.
            Contact your Admin to request access.
          </p>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <Component />
    </LayoutShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      <Route path="/">
        {() => <ProtectedRoute component={DashboardPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/calls">
        {() => <ProtectedRoute component={CallsListPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/calls/:id">
        {() => <ProtectedRoute component={CallDetailPage} requiredRoles={['admin','management','viewer']} />}
      </Route>
      <Route path="/alerts">
        {() => <ProtectedRoute component={AlertsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/reports">
        {() => <ProtectedRoute component={ReportsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/clients">
        {() => <ProtectedRoute component={ClientsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/fraud">
        {() => <ProtectedRoute component={FraudPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/cdrs">
        {() => <ProtectedRoute component={CDRsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/tools">
        {() => <ProtectedRoute component={ToolsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/team">
        {() => <ProtectedRoute component={TeamPage} requiredRoles={['admin']} />}
      </Route>
      <Route path="/traffic-map">
        {() => <ProtectedRoute component={TrafficMapPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/balance">
        {() => <ProtectedRoute component={BalanceMonitorPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/dids">
        {() => <ProtectedRoute component={DIDsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/server-monitoring">
        {() => <ProtectedRoute component={ServerMonitoringPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/graphs">
        {() => <ProtectedRoute component={GraphsPage} requiredRoles={['admin','management']} />}
      </Route>
      <Route path="/account">
        {() => <ProtectedRoute component={AccountPage} requiredRoles={['admin','management','viewer']} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
