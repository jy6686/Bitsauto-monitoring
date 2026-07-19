import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileSpreadsheet, Loader2, TrendingUp, TrendingDown, CreditCard,
  FileText, RefreshCw, Mail, Building2,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
type EntryType = 'bill' | 'payment' | 'credit_note' | 'debit_note' | 'write_off';

interface LedgerEntry {
  date:        string;
  type:        EntryType;
  reference:   string;
  description: string;
  debit:       number;
  credit:      number;
  balance:     number;
  currency:    string;
  sourceId:    number;
}

interface StatementData {
  partner: {
    id: number; name: string; type: string; currency: string;
    paymentTermsDays: number; contactName?: string; contactEmail?: string;
  };
  period: { from: string | null; to: string | null };
  summary: {
    totalBilled: number; totalPaid: number;
    totalCredits: number; totalDebits: number;
    closingBalance: number; entryCount: number;
  };
  ledger: LedgerEntry[];
}

interface BusinessPartner {
  id: number; name: string; type: string; status: string; currency: string;
}

// ── constants ─────────────────────────────────────────────────────────────────
const ENTRY_CFG: Record<EntryType, { label: string; color: string; icon: any }> = {
  bill:        { label: 'Bill',        color: 'text-blue-400    bg-blue-400/10    border-blue-400/30',    icon: FileText    },
  payment:     { label: 'Payment',     color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', icon: CreditCard  },
  credit_note: { label: 'Credit Note', color: 'text-teal-400    bg-teal-400/10    border-teal-400/30',    icon: TrendingDown },
  debit_note:  { label: 'Debit Note',  color: 'text-amber-400   bg-amber-400/10   border-amber-400/30',   icon: TrendingUp  },
  write_off:   { label: 'Write-Off',   color: 'text-red-400     bg-red-400/10     border-red-400/30',     icon: RefreshCw   },
};

function fmt(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

function EntryBadge({ type }: { type: EntryType }) {
  const cfg = ENTRY_CFG[type];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
      <Icon className="h-2.5 w-2.5" />{cfg.label}
    </Badge>
  );
}

// ── summary card ──────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, currency, color = '', sub,
}: { label: string; value: number; currency: string; color?: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-bold mt-1 ${color}`}>{fmt(value, currency)}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function VendorStatementPage() {
  const today      = new Date().toISOString().slice(0, 10);
  const yearStart  = `${new Date().getFullYear()}-01-01`;

  const [partnerId, setPartnerId] = useState('');
  const [from, setFrom]           = useState(yearStart);
  const [to, setTo]               = useState(today);
  const [queryKey, setQueryKey]   = useState<string | null>(null);  // triggers fetch

  // ── partners list ─────────────────────────────────────────────────────────
  const { data: partners = [] } = useQuery<BusinessPartner[]>({
    queryKey: ['/api/business-partners'],
    queryFn:  () => apiRequest('GET', '/api/business-partners').then(r => r.json()),
  });

  // ── statement data ────────────────────────────────────────────────────────
  const statementUrl = queryKey
    ? `/api/vendor-statement?partnerId=${queryKey}&from=${from}&to=${to}`
    : null;

  const { data: statement, isLoading, error } = useQuery<StatementData>({
    queryKey: ['vendor-statement', queryKey, from, to],
    queryFn:  () => apiRequest('GET', statementUrl!).then(r => r.json()),
    enabled:  statementUrl !== null,
  });

  const selectedPartner = partners.find(p => String(p.id) === partnerId);

  function runStatement() {
    if (!partnerId) return;
    setQueryKey(partnerId);
  }

  const currency = statement?.partner.currency ?? selectedPartner?.currency ?? 'USD';

  // ── balance colour ────────────────────────────────────────────────────────
  function balanceColor(n: number) {
    if (n <= 0) return 'text-emerald-400';
    if (n > 0)  return 'text-amber-400';
    return '';
  }

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Statement</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Per-vendor AP ledger — bills, payments and adjustments with running balance.
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-48">
              <p className="text-xs text-muted-foreground mb-1.5">Vendor</p>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {partners.filter(p => p.status === 'active').map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">From</p>
              <Input type="date" className="w-36" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">To</p>
              <Input type="date" className="w-36" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            <Button
              onClick={runStatement}
              disabled={!partnerId || isLoading}
              className="gap-2"
            >
              {isLoading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                : <><FileSpreadsheet className="h-4 w-4" /> Generate Statement</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-lg p-3">
          {(error as any).message ?? 'Failed to load statement'}
        </div>
      )}

      {/* Statement content */}
      {statement && (
        <>
          {/* Partner info bar */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start gap-4">
                <Building2 className="h-8 w-8 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{statement.partner.name}</h2>
                    <Badge variant="outline" className="text-xs capitalize">
                      {statement.partner.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-0.5">
                    {statement.partner.contactName && (
                      <span>{statement.partner.contactName}</span>
                    )}
                    {statement.partner.contactEmail && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />{statement.partner.contactEmail}
                      </span>
                    )}
                    <span>Net {statement.partner.paymentTermsDays} days</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">Statement Period</p>
                  <p className="text-sm font-medium">
                    {statement.period.from ?? 'All time'} → {statement.period.to ?? 'Today'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {statement.summary.entryCount} transaction{statement.summary.entryCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard
              label="Total Billed"
              value={statement.summary.totalBilled}
              currency={currency}
              color="text-blue-400"
            />
            <SummaryCard
              label="Total Paid"
              value={statement.summary.totalPaid}
              currency={currency}
              color="text-emerald-400"
            />
            <SummaryCard
              label="Credits"
              value={statement.summary.totalCredits}
              currency={currency}
              color="text-teal-400"
              sub="Credit notes + write-offs"
            />
            <SummaryCard
              label="Debits"
              value={statement.summary.totalDebits}
              currency={currency}
              color="text-amber-400"
              sub="Debit notes"
            />
            <Card className="md:col-span-1">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding Balance</p>
                <p className={`text-xl font-bold mt-1 ${balanceColor(statement.summary.closingBalance)}`}>
                  {fmt(statement.summary.closingBalance, currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {statement.summary.closingBalance <= 0
                    ? 'Fully settled'
                    : 'Amount still owed to vendor'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Ledger */}
          {statement.ledger.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                <FileSpreadsheet className="h-8 w-8 opacity-30" />
                <p className="text-sm">No transactions found for this vendor in the selected period.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-0 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Transaction Ledger — {statement.partner.currency}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead className="w-32">Type</TableHead>
                      <TableHead className="w-36">Reference</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right w-28">Charges</TableHead>
                      <TableHead className="text-right w-28">Payments</TableHead>
                      <TableHead className="text-right w-32">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Opening row */}
                    <TableRow className="bg-muted/20 text-muted-foreground">
                      <TableCell className="text-xs py-2">—</TableCell>
                      <TableCell className="text-xs py-2" colSpan={5}>Opening Balance</TableCell>
                      <TableCell className="text-right text-xs py-2 font-medium">
                        {fmt(0, currency)}
                      </TableCell>
                    </TableRow>

                    {statement.ledger.map((entry, i) => (
                      <TableRow
                        key={`${entry.type}-${entry.sourceId}-${i}`}
                        className="hover:bg-muted/30"
                      >
                        <TableCell className="text-sm text-muted-foreground py-3">
                          {entry.date}
                        </TableCell>
                        <TableCell className="py-3">
                          <EntryBadge type={entry.type} />
                        </TableCell>
                        <TableCell className="font-mono text-xs py-3 text-muted-foreground">
                          {entry.reference}
                        </TableCell>
                        <TableCell className="text-sm py-3 text-muted-foreground">
                          {entry.description}
                        </TableCell>
                        <TableCell className="text-right py-3 text-sm">
                          {entry.debit > 0 ? (
                            <span className="text-blue-400 font-medium">{fmt(entry.debit, currency)}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right py-3 text-sm">
                          {entry.credit > 0 ? (
                            <span className="text-emerald-400 font-medium">{fmt(entry.credit, currency)}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right py-3 font-semibold text-sm ${balanceColor(entry.balance)}`}>
                          {fmt(entry.balance, currency)}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Closing row */}
                    <TableRow className="bg-muted/30 border-t-2">
                      <TableCell className="py-3" colSpan={4}>
                        <span className="text-sm font-semibold">Closing Balance</span>
                      </TableCell>
                      <TableCell className="text-right py-3">
                        <span className="text-sm font-medium text-blue-400">
                          {fmt(statement.summary.totalBilled + statement.summary.totalDebits, currency)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right py-3">
                        <span className="text-sm font-medium text-emerald-400">
                          {fmt(statement.summary.totalPaid + statement.summary.totalCredits, currency)}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right py-3 text-base font-bold ${balanceColor(statement.summary.closingBalance)}`}>
                        {fmt(statement.summary.closingBalance, currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty state before selection */}
      {!statement && !isLoading && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
            <FileSpreadsheet className="h-10 w-10 opacity-20" />
            <div className="text-center">
              <p className="text-sm font-medium">Select a vendor and click Generate Statement</p>
              <p className="text-xs mt-1">
                The ledger will show all bills, payments and adjustments for the selected period.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
