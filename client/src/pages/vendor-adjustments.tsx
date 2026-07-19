import { Calculator, Scale, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorAdjustmentsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Calculator className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Adjustments</h1>
          <p className="text-muted-foreground mt-1">
            Issue and track debit notes and credit notes against vendors to correct billing errors or apply concessions.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-amber-400 border-amber-400/40">
          Phase 3 — Sprint A3
        </Badge>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned Capabilities</CardTitle>
          <CardDescription>This module will be implemented in Phase 3 — Accounts Payable Sprint A3.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "📉", text: "Credit notes: reduce amounts owed to a vendor" },
              { icon: "📈", text: "Debit notes: record additional amounts owed to a vendor" },
              { icon: "🔗", text: "Link adjustments to originating bill for clear audit trail" },
              { icon: "💬", text: "Reason codes and free-text justification on every adjustment" },
              { icon: "📊", text: "Net adjustment balance reflected in Vendor Statement" },
              { icon: "🧾", text: "Adjustment reference numbers VA-YYYY-NNNN for external correspondence" },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <span className="text-base leading-5">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Context hint */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4 bg-muted/20">
        <Scale className="h-4 w-4 shrink-0" />
        <span>Requires Migration 025 (vendor_adjustments) — scheduled for Sprint A3 alongside Vendor Payments.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
