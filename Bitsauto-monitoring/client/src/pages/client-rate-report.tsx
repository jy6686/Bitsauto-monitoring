import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, X, Globe, FileSpreadsheet, RefreshCw } from "lucide-react";

interface SippyAccount {
  iAccount: number;
  username?: string;
  name?: string;
  companyName?: string;
}

interface RateRow {
  prefix: string;
  country: string;
  description: string;
  rate: number;
  localRate?: number;
  // from tariff-rates endpoint
  price1?: number;
  priceN?: number;
  interval1?: number;
  intervalN?: number;
  activationDate?: string;
  expirationDate?: string;
  areaName?: string;
}

const FLAG_MAP: Record<string, string> = {
  "Afghanistan": "🇦🇫", "Albania": "🇦🇱", "Algeria": "🇩🇿", "Argentina": "🇦🇷", "Armenia": "🇦🇲",
  "Australia": "🇦🇺", "Austria": "🇦🇹", "Azerbaijan": "🇦🇿", "Bahrain": "🇧🇭", "Bangladesh": "🇧🇩",
  "Belarus": "🇧🇾", "Belgium": "🇧🇪", "Bolivia": "🇧🇴", "Bosnia": "🇧🇦", "Brazil": "🇧🇷",
  "Bulgaria": "🇧🇬", "Cambodia": "🇰🇭", "Canada": "🇨🇦", "Chile": "🇨🇱", "China": "🇨🇳",
  "Colombia": "🇨🇴", "Croatia": "🇭🇷", "Cuba": "🇨🇺", "Cyprus": "🇨🇾", "Czech": "🇨🇿",
  "Denmark": "🇩🇰", "Ecuador": "🇪🇨", "Egypt": "🇪🇬", "Estonia": "🇪🇪", "Ethiopia": "🇪🇹",
  "Finland": "🇫🇮", "France": "🇫🇷", "Georgia": "🇬🇪", "Germany": "🇩🇪", "Ghana": "🇬🇭",
  "Greece": "🇬🇷", "Guatemala": "🇬🇹", "Honduras": "🇭🇳", "Hong Kong": "🇭🇰", "Hungary": "🇭🇺",
  "India": "🇮🇳", "Indonesia": "🇮🇩", "Iran": "🇮🇷", "Iraq": "🇮🇶", "Ireland": "🇮🇪",
  "Israel": "🇮🇱", "Italy": "🇮🇹", "Japan": "🇯🇵", "Jordan": "🇯🇴", "Kazakhstan": "🇰🇿",
  "Kenya": "🇰🇪", "Korea": "🇰🇷", "Kuwait": "🇰🇼", "Kyrgyzstan": "🇰🇬", "Latvia": "🇱🇻",
  "Lebanon": "🇱🇧", "Libya": "🇱🇾", "Lithuania": "🇱🇹", "Luxembourg": "🇱🇺", "Macedonia": "🇲🇰",
  "Malaysia": "🇲🇾", "Mexico": "🇲🇽", "Moldova": "🇲🇩", "Mongolia": "🇲🇳", "Morocco": "🇲🇦",
  "Netherlands": "🇳🇱", "New Zealand": "🇳🇿", "Nigeria": "🇳🇬", "Norway": "🇳🇴", "Oman": "🇴🇲",
  "Pakistan": "🇵🇰", "Palestine": "🇵🇸", "Panama": "🇵🇦", "Paraguay": "🇵🇾", "Peru": "🇵🇪",
  "Philippines": "🇵🇭", "Poland": "🇵🇱", "Portugal": "🇵🇹", "Qatar": "🇶🇦", "Romania": "🇷🇴",
  "Russia": "🇷🇺", "Saudi Arabia": "🇸🇦", "Senegal": "🇸🇳", "Serbia": "🇷🇸", "Singapore": "🇸🇬",
  "Slovakia": "🇸🇰", "Slovenia": "🇸🇮", "Somalia": "🇸🇴", "South Africa": "🇿🇦", "Spain": "🇪🇸",
  "Sri Lanka": "🇱🇰", "Sudan": "🇸🇩", "Sweden": "🇸🇪", "Switzerland": "🇨🇭", "Syria": "🇸🇾",
  "Taiwan": "🇹🇼", "Tajikistan": "🇹🇯", "Tanzania": "🇹🇿", "Thailand": "🇹🇭", "Tunisia": "🇹🇳",
  "Turkey": "🇹🇷", "Turkmenistan": "🇹🇲", "Uganda": "🇺🇬", "Ukraine": "🇺🇦",
  "United Arab Emirates": "🇦🇪", "UAE": "🇦🇪", "United Kingdom": "🇬🇧", "UK": "🇬🇧",
  "United States": "🇺🇸", "USA": "🇺🇸", "Uruguay": "🇺🇾", "Uzbekistan": "🇺🇿",
  "Venezuela": "🇻🇪", "Vietnam": "🇻🇳", "Yemen": "🇾🇪", "Zambia": "🇿🇲", "Zimbabwe": "🇿🇼",
};

function getFlag(country: string): string {
  if (!country) return "🌐";
  for (const [k, v] of Object.entries(FLAG_MAP)) {
    if (country.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(country.toLowerCase())) return v;
  }
  return "🌐";
}

function formatDate(d?: string): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
}

export default function ClientRateReportPage() {
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterDestination, setFilterDestination] = useState("");
  const [filterPrefix, setFilterPrefix] = useState("");
  const [filterActiveFrom, setFilterActiveFrom] = useState("");
  const [filterActiveTo, setFilterActiveTo] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts?: SippyAccount[] }>({
    queryKey: ["/api/sippy/accounts"],
  });

  const accounts = useMemo(() => {
    const list: SippyAccount[] = accountsData?.accounts ?? (Array.isArray(accountsData) ? (accountsData as any) : []);
    return list.sort((a, b) => {
      const nameA = (a.username || a.name || String(a.iAccount)).toLowerCase();
      const nameB = (b.username || b.name || String(b.iAccount)).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [accountsData]);

  const { data: ratesData, isLoading: ratesLoading, refetch, isFetching } = useQuery<{ success: boolean; rates: RateRow[]; currency?: string; iTariff?: number; error?: string }>({
    queryKey: ["/api/sippy/accounts", selectedAccount, "tariff-rates"],
    queryFn: async () => {
      const resp = await fetch(`/api/sippy/accounts/${selectedAccount}/tariff-rates`);
      return resp.json();
    },
    enabled: !!selectedAccount && searchTriggered,
  });

  const filteredRates = useMemo(() => {
    const rows: RateRow[] = ratesData?.rates ?? [];
    return rows.filter(r => {
      const countryOk = !filterCountry || (r.country || "").toLowerCase().includes(filterCountry.toLowerCase());
      const destOk = !filterDestination || (r.description || "").toLowerCase().includes(filterDestination.toLowerCase());
      const prefixOk = !filterPrefix || (r.prefix || "").startsWith(filterPrefix);
      let fromOk = true, toOk = true;
      if (filterActiveFrom && r.activationDate) {
        fromOk = new Date(r.activationDate) >= new Date(filterActiveFrom);
      }
      if (filterActiveTo && r.expirationDate) {
        toOk = new Date(r.expirationDate) <= new Date(filterActiveTo + "T23:59:59");
      }
      return countryOk && destOk && prefixOk && fromOk && toOk;
    });
  }, [ratesData, filterCountry, filterDestination, filterPrefix, filterActiveFrom, filterActiveTo]);

  function handleSearch() {
    if (!selectedAccount) {
      toast({ title: "Select a client", description: "Please choose a client account first.", variant: "destructive" });
      return;
    }
    setSearchTriggered(true);
    refetch();
  }

  function handleClear() {
    setFilterCountry(""); setFilterDestination(""); setFilterPrefix("");
    setFilterActiveFrom(""); setFilterActiveTo("");
  }

  const currency = ratesData?.currency ?? "USD";

  return (
    <div className="p-6 space-y-5 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Globe className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Client Rate Report</h1>
          <p className="text-sm text-muted-foreground">View destination-level rates for any client account</p>
        </div>
        {ratesData?.iTariff && (
          <Badge variant="outline" className="ml-auto text-xs">Tariff #{ratesData.iTariff}</Badge>
        )}
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Search className="h-3.5 w-3.5" /> Filter Options
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Client selector */}
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Client Account <span className="text-rose-400">*</span></Label>
              <Select value={selectedAccount} onValueChange={v => { setSelectedAccount(v); setSearchTriggered(false); }}>
                <SelectTrigger data-testid="select-client" className="h-9">
                  <SelectValue placeholder={accountsLoading ? "Loading clients..." : "Select a client..."} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {accounts.map(a => (
                    <SelectItem key={a.iAccount} value={String(a.iAccount)} data-testid={`option-account-${a.iAccount}`}>
                      <span className="font-mono text-xs text-muted-foreground mr-2">#{a.iAccount}</span>
                      {a.username || a.name || `Account ${a.iAccount}`}
                      {a.companyName && a.companyName !== (a.username || a.name) && (
                        <span className="text-muted-foreground ml-1">· {a.companyName}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Text filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Country</Label>
              <Input data-testid="input-country" placeholder="e.g. Pakistan" value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Destination</Label>
              <Input data-testid="input-destination" placeholder="e.g. Mobile" value={filterDestination} onChange={e => setFilterDestination(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Prefix / Code</Label>
              <Input data-testid="input-prefix" placeholder="e.g. 9233" value={filterPrefix} onChange={e => setFilterPrefix(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Active From</Label>
              <Input data-testid="input-active-from" type="date" value={filterActiveFrom} onChange={e => setFilterActiveFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Active To</Label>
              <Input data-testid="input-active-to" type="date" value={filterActiveTo} onChange={e => setFilterActiveTo(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button data-testid="button-search" onClick={handleSearch} disabled={!selectedAccount || isFetching} className="h-9 gap-2">
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isFetching ? "Loading..." : "Search"}
            </Button>
            {selectedAccount && searchTriggered && (
              <Button data-testid="button-refresh" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-9 gap-2">
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>
            )}
            <Button data-testid="button-clear-filters" variant="ghost" onClick={handleClear} className="h-9 gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Clear Filters
            </Button>
            {searchTriggered && ratesData && (
              <span className="ml-auto text-xs text-muted-foreground">
                {filteredRates.length} of {ratesData.rates?.length ?? 0} rates · {currency}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results table */}
      {!searchTriggered ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <FileSpreadsheet className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">Select a client account and click <strong>Search</strong> to view rates.</p>
        </div>
      ) : ratesLoading || isFetching ? (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading tariff rates…</span>
        </div>
      ) : ratesData?.error ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <p className="text-rose-400 text-sm font-medium">{ratesData.error}</p>
          <p className="text-xs text-muted-foreground">Check the client account has an assigned tariff in Sippy.</p>
        </div>
      ) : filteredRates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-2">
          <Search className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No rates match the current filters.</p>
        </div>
      ) : (
        <Card className="border-border/50">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40">
                  <TableHead className="w-[160px]">Country</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="font-mono">Code</TableHead>
                  <TableHead className="text-right">Rate ({currency}/min)</TableHead>
                  <TableHead>Activation Time</TableHead>
                  <TableHead>Expiration Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRates.map((row, idx) => {
                  const flag = getFlag(row.country);
                  const rate = row.priceN ?? row.rate;
                  const isExpired = row.expirationDate ? new Date(row.expirationDate) < new Date() : false;
                  return (
                    <TableRow key={idx} data-testid={`row-rate-${idx}`} className={cn("border-border/30 hover:bg-muted/30", isExpired && "opacity-50")}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-base leading-none">{flag}</span>
                          <span className="text-sm">{row.country || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.description || row.areaName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm text-violet-400">{row.prefix}</TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm font-medium">{rate.toFixed(5)}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(row.activationDate)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.expirationDate ? (
                          <span className={cn(isExpired && "text-rose-400")}>{formatDate(row.expirationDate)}</span>
                        ) : (
                          <span className="text-emerald-500/70">Active</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
