// Placeholder — CAP-003 Phase 4 Sprint T3 (bank-reconciliation.tsx)
import { Scale } from "lucide-react";

export default function BankReconciliationPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Scale className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bank Reconciliation</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Match bank statement lines to system payments. Identify exceptions and close reconciliation periods.
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-border p-10 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
        <Scale className="h-10 w-10 opacity-20" />
        <p className="text-sm font-medium">Phase 4 Sprint T3 — Bank Reconciliation</p>
        <p className="text-xs max-w-sm">
          Import bank statements (CSV), auto-match lines to vendor payments, handle exceptions and close reconciliation periods with variance reporting.
        </p>
      </div>
    </div>
  );
}
