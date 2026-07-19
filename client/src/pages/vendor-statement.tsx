import { FileSpreadsheet, BarChart2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorStatementPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Statement</h1>
          <p className="text-muted-foreground mt-1">
            Per-vendor AP statement showing all bills, payments and adjustments with a running outstanding balance.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-amber-400 border-amber-400/40">
          Phase 3 — Sprint A4
        </Badge>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned Capabilities</CardTitle>
          <CardDescription>This module will be implemented in Phase 3 — Accounts Payable Sprint A4.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "📊", text: "Chronological transaction ledger: bills, payments and adjustments in one view" },
              { icon: "💰", text: "Running balance column showing outstanding amount after each transaction" },
              { icon: "📅", text: "Filter by date range, transaction type and status" },
              { icon: "🔍", text: "Drill through any row to the originating bill, payment or adjustment" },
              { icon: "📤", text: "Export statement as PDF or CSV for vendor reconciliation" },
              { icon: "📬", text: "Share statement directly with vendor contact via email" },
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
        <BarChart2 className="h-4 w-4 shrink-0" />
        <span>Aggregates data from Vendor Bills, Vendor Payments and Vendor Adjustments into a single statement view.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
