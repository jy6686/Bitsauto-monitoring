import { Receipt, Settings, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function TaxVatPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Receipt className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tax / VAT</h1>
          <p className="text-muted-foreground mt-1">
            Configure VAT rules, tax codes, and compliance settings for UAE FTA and other jurisdictions.
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
          <CardDescription>This module will be implemented in Phase 5 (C1 &amp; C2) — VAT / Tax.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "📐", text: "Define VAT rules: standard rate (5%), zero-rated, exempt by service type" },
              { icon: "🧮", text: "Automatic VAT calculation on invoice line items" },
              { icon: "📒", text: "VAT Ledger — running liability and input/output tax summary" },
              { icon: "📊", text: "VAT Return reports aligned to UAE FTA reporting periods" },
              { icon: "🇦🇪", text: "UAE FTA XML export for VAT Return filing (Phase 5 C2)" },
              { icon: "✅", text: "Compliance Dashboard — filing calendar and submission status" },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <span className="text-base leading-5">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Phasing note */}
      <div className="flex items-start gap-2 text-sm border rounded-lg p-4 bg-muted/20">
        <Settings className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">Phase 5 is split into two sprints:</span>
          {" "}C1 delivers VAT Rules, Calculation, and Ledger.
          C2 delivers VAT Reports, FTA Export, and the Compliance Dashboard.
          <ArrowRight className="h-4 w-4 inline ml-1" />
        </div>
      </div>
    </div>
  );
}
