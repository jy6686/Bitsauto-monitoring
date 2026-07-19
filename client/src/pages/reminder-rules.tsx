import { Bell, Settings, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ReminderRulesPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Bell className="h-7 w-7 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reminder Rules</h1>
          <p className="text-muted-foreground mt-1">
            Define automated payment reminder schedules, escalation ladders, and message templates.
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
              { icon: "⏰", text: "Create reminder trigger rules (e.g. 7 days before due, on due date, 14 days overdue)" },
              { icon: "📧", text: "Assign email message templates per reminder stage" },
              { icon: "📈", text: "Configure escalation ladders with tone changes across stages" },
              { icon: "⏸️", text: "Pause or suppress reminders per client when disputes are open" },
              { icon: "📋", text: "Link rules to specific payment term sets for automatic matching" },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <span className="text-base leading-5">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Current state note */}
      <div className="flex items-start gap-2 text-sm border rounded-lg p-4 bg-muted/20">
        <Settings className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">Current state:</span> Payment reminders can be sent manually from the{" "}
          <span className="font-medium text-foreground">Payment Reminders</span> page. This module will automate the scheduling logic.
          <ArrowRight className="h-4 w-4 inline ml-1" />
        </div>
      </div>
    </div>
  );
}
