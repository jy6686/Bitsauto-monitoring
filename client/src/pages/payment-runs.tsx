// Placeholder — CAP-003 Phase 4 Sprint T2 (payment-runs.tsx)
import { SendHorizontal } from "lucide-react";

export default function PaymentRunsPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <SendHorizontal className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Runs</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Batch vendor payment runs — select approved bills, review, approve and execute.
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-border p-10 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
        <SendHorizontal className="h-10 w-10 opacity-20" />
        <p className="text-sm font-medium">Phase 4 Sprint T2 — Payment Runs</p>
        <p className="text-xs max-w-sm">
          Create payment runs from approved vendor bills. Select the source treasury account, review the run, approve and execute. Vendor payments are created automatically on execution.
        </p>
      </div>
    </div>
  );
}
