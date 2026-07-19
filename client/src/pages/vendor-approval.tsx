import { CheckCircle, BadgeCheck, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorApprovalPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <CheckCircle className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Approval</h1>
          <p className="text-muted-foreground mt-1">
            Single and bulk bill approval workflow with full audit trail — who approved, when, and for how much.
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
              { icon: "📋", text: "Approval queue showing all bills that passed verification" },
              { icon: "✅", text: "Single-click approve or reject with mandatory reason on rejection" },
              { icon: "📦", text: "Bulk approval for batches of low-risk, pre-verified bills" },
              { icon: "🚫", text: "Self-approval prevention — submitters cannot approve their own bills" },
              { icon: "🕵️", text: "Full audit log: approved_by, approved_at, approval_status per bill" },
              { icon: "🔔", text: "Notifications to finance team on approval and rejection events" },
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
        <BadgeCheck className="h-4 w-4 shrink-0" />
        <span>Approved bills unlock Vendor Payments — only approved bills can receive payment allocations.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
