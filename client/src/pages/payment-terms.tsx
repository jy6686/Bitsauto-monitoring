import { Clock, Settings, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PaymentTermsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Clock className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Terms</h1>
          <p className="text-muted-foreground mt-1">
            Define standard payment windows, due-date rules, and early-payment discounts applied to invoices.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-amber-400 border-amber-400/40">
          Phase 5 — Planned
        </Badge>
      </div>

      {/* Planned capabilities */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned Capabilities</CardTitle>
          <CardDescription>This module will be implemented in Phase 5 — Finance Configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "📋", text: "Define named term sets (e.g. Net 30, Net 60, Due on Receipt)" },
              { icon: "📅", text: "Configure due-date calculation rules relative to invoice date" },
              { icon: "💸", text: "Set early-payment discount percentages and discount windows" },
              { icon: "🔗", text: "Assign default terms per client or client group" },
              { icon: "📊", text: "Override terms on individual invoices when needed" },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <span className="text-base leading-5">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Navigation hint */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4 bg-muted/20">
        <Settings className="h-4 w-4 shrink-0" />
        <span>Configured here and applied across Invoices, Invoice Schedules, and Client Reconciliation.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
