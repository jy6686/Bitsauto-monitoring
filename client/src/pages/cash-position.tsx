// Placeholder — CAP-003 Phase 4 Sprint T4 (cash-position.tsx)
import { PieChart } from "lucide-react";

export default function CashPositionPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <PieChart className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cash Position</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Net cash position — bank and wallet balances, outstanding AP, outstanding AR and upcoming obligations.
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-border p-10 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
        <PieChart className="h-10 w-10 opacity-20" />
        <p className="text-sm font-medium">Phase 4 Sprint T4 — Cash Position</p>
        <p className="text-xs max-w-sm">
          Aggregated treasury view: bank + wallet balances (assets), approved unpaid vendor bills (AP liabilities), outstanding invoices (AR assets). Net cash position with upcoming obligation schedule.
        </p>
      </div>
    </div>
  );
}
