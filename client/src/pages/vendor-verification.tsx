import { ShieldCheck, ClipboardCheck, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorVerificationPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Verification</h1>
          <p className="text-muted-foreground mt-1">
            Review submitted vendor bills for accuracy, completeness and compliance before approval.
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
              { icon: "🔎", text: "Queue of bills awaiting review, sorted by due date" },
              { icon: "✅", text: "Line-by-line verification against purchase orders or agreements" },
              { icon: "📋", text: "Checklist-based review with per-item pass / flag / reject" },
              { icon: "💬", text: "Add internal notes and flag discrepancies for follow-up" },
              { icon: "📤", text: "Send verified bills forward to the Approval workflow" },
              { icon: "🔁", text: "Return bills to vendor with query details when corrections needed" },
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
        <ClipboardCheck className="h-4 w-4 shrink-0" />
        <span>Bills must pass verification before they become eligible for Vendor Approval.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
