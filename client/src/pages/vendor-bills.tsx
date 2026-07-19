import { FileText, Receipt, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorBillsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <FileText className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Bills</h1>
          <p className="text-muted-foreground mt-1">
            Capture, track, and manage AP invoices received from vendors across the full bill lifecycle.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto shrink-0 text-amber-400 border-amber-400/40">
          Phase 3 — Sprint A2
        </Badge>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned Capabilities</CardTitle>
          <CardDescription>This module will be implemented in Phase 3 — Accounts Payable Sprint A2.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "📥", text: "Create vendor bills with line items, GL codes and tax rates" },
              { icon: "🔢", text: "Auto-generated VB-YYYY-NNNN bill numbers on submission" },
              { icon: "📎", text: "Attach scanned invoice PDFs and supporting documents" },
              { icon: "🔄", text: "Full status lifecycle: draft → submitted → approved → paid" },
              { icon: "🔍", text: "Filter by vendor, status, due date and amount range" },
              { icon: "💰", text: "Outstanding balance tracking updated on each payment allocation" },
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
        <Receipt className="h-4 w-4 shrink-0" />
        <span>Bills flow into Vendor Verification then Vendor Approval before payment can be recorded.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
