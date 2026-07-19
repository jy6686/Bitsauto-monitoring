import { Hash, Settings, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function NumberingPrefixesPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Hash className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Numbering &amp; Prefixes</h1>
          <p className="text-muted-foreground mt-1">
            Control invoice number sequences, prefixes, and document reference formats used across Finance.
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
              { icon: "🔢", text: "Set invoice number prefix (e.g. INV-, BA-) and starting sequence" },
              { icon: "📝", text: "Configure credit note and dispute reference formats" },
              { icon: "📆", text: "Include year/month segments in document numbers (e.g. INV-2026-0001)" },
              { icon: "🔄", text: "Reset sequences annually or use continuous numbering" },
              { icon: "🏷️", text: "Per-entity number series for multi-entity billing environments" },
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
        <span>Number formats defined here are applied automatically when invoices and credit notes are generated.</span>
        <ArrowRight className="h-4 w-4 ml-auto shrink-0" />
      </div>
    </div>
  );
}
