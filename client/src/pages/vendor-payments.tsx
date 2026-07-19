import { CreditCard, Banknote, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VendorPaymentsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <CreditCard className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Payments</h1>
          <p className="text-muted-foreground mt-1">
            Record outbound payments to vendors and allocate them against approved bills to reduce outstanding balances.
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
              { icon: "💳", text: "Record payments by method: bank transfer, cheque, card or direct debit" },
              { icon: "📎", text: "Allocate a single payment across multiple approved bills" },
              { icon: "💰", text: "Partial payment support — bills move to partially_paid status" },
              { icon: "📊", text: "Auto-reduce outstanding balance on each bill as allocations are posted" },
              { icon: "🧾", text: "Payment reference and bank transaction ID for reconciliation" },
              { icon: "📅", text: "Payment date, currency and exchange rate captured per transaction" },
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
        <Banknote className="h-4 w-4 shrink-0" />
        <span>Requires Migration 024 (vendor_payments + vendor_payment_allocations) — scheduled for Sprint A3.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
