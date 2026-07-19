import { DollarSign, Settings, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function CurrencySettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <DollarSign className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Currency</h1>
          <p className="text-muted-foreground mt-1">
            Configure base currency, supported billing currencies, and exchange rate management for Finance operations.
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
          <CardDescription>This module will be implemented in Phase 5 — Finance Configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              { icon: "💱", text: "Set base (functional) currency for all Finance reporting" },
              { icon: "🌍", text: "Enable additional billing currencies (USD, EUR, AED, GBP, USDT)" },
              { icon: "📈", text: "Configure exchange rate source: manual, ECB feed, or custom API" },
              { icon: "📅", text: "Set rate refresh frequency and historical rate retention policy" },
              { icon: "🧾", text: "Define which currency appears on invoices per client or region" },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <span className="text-base leading-5">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Navigation hint */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4 bg-muted/20">
        <Settings className="h-4 w-4 shrink-0" />
        <span>Multi-currency support will also extend to Treasury (Phase 4) wallet balances and bank accounts.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
