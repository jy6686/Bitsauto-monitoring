import { useState } from "react";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Download, ShieldCheck, Info, User, Globe, Wifi, Lock, Terminal,
  CheckCircle2, AlertTriangle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Extract server IP/hostname from a URL string
function extractHost(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return url.split(":")[0] ?? url;
  }
}

// Generate .ovpn file content
function buildOvpnContent(cfg: {
  serverIp: string;
  port: number;
  proto: "udp" | "tcp";
  memberName: string;
  memberEmail: string;
  os: string;
  keepaliveInterval: number;
  keepaliveTimeout: number;
  useTLS: boolean;
}): string {
  const osComment =
    cfg.os === "windows"
      ? "# Platform: Windows — open with OpenVPN GUI v2.5+"
      : cfg.os === "macos"
        ? "# Platform: macOS — open with Tunnelblick or OpenVPN Connect"
        : "# Platform: Linux — use: sudo openvpn --config <filename>.ovpn";

  return [
    `# Bitsauto Monitoring — VPN Client Configuration`,
    `# Generated for: ${cfg.memberName} <${cfg.memberEmail}>`,
    osComment,
    `# Generated: ${new Date().toUTCString()}`,
    `#`,
    `# IMPORTANT: Replace the <ca>, <cert> and <key> blocks below`,
    `# with your actual certificate data from the Sippy VPN server admin.`,
    `#`,
    ``,
    `client`,
    `dev tun`,
    `proto ${cfg.proto}`,
    `remote ${cfg.serverIp} ${cfg.port}`,
    `resolv-retry infinite`,
    `nobind`,
    `persist-key`,
    `persist-tun`,
    ``,
    `# Server authentication`,
    `remote-cert-tls server`,
    `${cfg.useTLS ? "tls-client" : "# tls-client"}`,
    ``,
    `# Encryption`,
    `cipher AES-256-GCM`,
    `auth SHA256`,
    ``,
    `# Keep-alive: ping every ${cfg.keepaliveInterval}s, restart if no response in ${cfg.keepaliveTimeout}s`,
    `keepalive ${cfg.keepaliveInterval} ${cfg.keepaliveTimeout}`,
    ``,
    `# Logging (0=silent, 3=normal, 6=verbose)`,
    `verb 3`,
    ``,
    `# ── Certificate Authority (paste the ca.crt content from your VPN server) ──`,
    `<ca>`,
    `-----BEGIN CERTIFICATE-----`,
    `# PASTE YOUR CA CERTIFICATE HERE`,
    `-----END CERTIFICATE-----`,
    `</ca>`,
    ``,
    `# ── Client Certificate (paste this user's client.crt content) ──`,
    `<cert>`,
    `-----BEGIN CERTIFICATE-----`,
    `# PASTE CLIENT CERTIFICATE HERE`,
    `-----END CERTIFICATE-----`,
    `</cert>`,
    ``,
    `# ── Client Private Key (paste this user's client.key content) ──`,
    `<key>`,
    `-----BEGIN PRIVATE KEY-----`,
    `# PASTE CLIENT PRIVATE KEY HERE`,
    `-----END PRIVATE KEY-----`,
    `</key>`,
    ``,
    cfg.useTLS
      ? [
          `# ── TLS Auth Key (paste ta.key content; direction=1 for clients) ──`,
          `key-direction 1`,
          `<tls-auth>`,
          `# PASTE YOUR ta.key CONTENT HERE`,
          `</tls-auth>`,
        ].join("\n")
      : `# tls-auth not enabled — add if your VPN server uses it`,
  ].join("\n");
}

const OS_OPTIONS = [
  { value: "windows", label: "Windows" },
  { value: "macos",   label: "macOS" },
  { value: "linux",   label: "Linux" },
];

const PROTO_OPTIONS = [
  { value: "udp", label: "UDP (recommended)" },
  { value: "tcp", label: "TCP (use if UDP is blocked)" },
];

const SETUP_STEPS: Record<string, { tool: string; steps: string[] }> = {
  windows: {
    tool: "OpenVPN GUI v2.5+",
    steps: [
      "Download and install OpenVPN GUI from openvpn.net",
      "Right-click the OpenVPN tray icon → Import config → select this .ovpn file",
      "Fill in the certificate blocks (ca, cert, key) provided by your server admin",
      "Right-click tray icon → Connect",
    ],
  },
  macos: {
    tool: "Tunnelblick or OpenVPN Connect",
    steps: [
      "Download Tunnelblick from tunnelblick.net (free) or OpenVPN Connect from openvpn.com",
      "Double-click the .ovpn file to import it into Tunnelblick",
      "Fill in the certificate blocks provided by your server admin",
      "Click 'Connect' from the menu bar icon",
    ],
  },
  linux: {
    tool: "openvpn CLI",
    steps: [
      "Install OpenVPN: sudo apt install openvpn  (or yum/dnf for RHEL-based)",
      "Copy the .ovpn file to /etc/openvpn/",
      "Fill in the certificate blocks provided by your server admin",
      "Run: sudo openvpn --config /etc/openvpn/<filename>.ovpn",
      "Or as a service: sudo systemctl enable --now openvpn@<filename>",
    ],
  },
};

export default function VpnConfigPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { toast } = useToast();

  const defaultServerIp = settings?.portalUrl ? extractHost(settings.portalUrl) : "";

  const [memberName,        setMemberName]        = useState("");
  const [memberEmail,       setMemberEmail]        = useState("");
  const [os,                setOs]                = useState("windows");
  const [serverIp,          setServerIp]          = useState("");
  const [port,              setPort]              = useState(1194);
  const [proto,             setProto]             = useState<"udp" | "tcp">("udp");
  const [keepaliveInterval, setKeepaliveInterval] = useState(10);
  const [keepaliveTimeout,  setKeepaliveTimeout]  = useState(120);
  const [useTLS,            setUseTLS]            = useState(true);

  const effectiveServerIp = serverIp || defaultServerIp;
  const canGenerate = !!effectiveServerIp && !!memberName;

  const handleGenerate = () => {
    if (!canGenerate) {
      toast({ title: "Required fields missing", description: "Please enter a team member name and verify the server IP.", variant: "destructive" });
      return;
    }
    const content = buildOvpnContent({
      serverIp: effectiveServerIp,
      port,
      proto,
      memberName,
      memberEmail,
      os,
      keepaliveInterval,
      keepaliveTimeout,
      useTLS,
    });

    const slug = memberName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const filename = `bitsauto-vpn-${slug}.ovpn`;
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: "Config downloaded", description: `${filename} is ready. Send it to ${memberName} along with the certificate files.` });
  };

  const osInfo = SETUP_STEPS[os] ?? SETUP_STEPS.windows;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-400" />
          <h2 className="text-2xl font-bold tracking-tight">VPN Config Generator</h2>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Generate a ready-to-use <code className="text-xs bg-muted px-1 py-0.5 rounded">.ovpn</code> config file for a team member to connect to the Sippy switch management VPN.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/25 bg-blue-500/8 text-blue-300 text-sm">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">Before distributing configs</p>
          <p className="text-xs opacity-80">
            OpenVPN must be installed and configured on the Sippy server. The generated file is a <strong>template</strong> —
            the recipient must fill in the <code className="bg-blue-900/40 px-1 rounded">&lt;ca&gt;</code>, <code className="bg-blue-900/40 px-1 rounded">&lt;cert&gt;</code> and <code className="bg-blue-900/40 px-1 rounded">&lt;key&gt;</code> blocks
            with certificate files issued by the VPN server admin.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Config form */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4 text-emerald-400" /> Team Member Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="vpn-name">Full Name *</Label>
              <Input
                id="vpn-name"
                data-testid="input-vpn-name"
                placeholder="e.g. John Smith"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vpn-email">Email</Label>
              <Input
                id="vpn-email"
                data-testid="input-vpn-email"
                type="email"
                placeholder="e.g. john@example.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target OS</Label>
              <Select value={os} onValueChange={setOs}>
                <SelectTrigger data-testid="select-vpn-os">
                  <SelectValue placeholder="Select OS" />
                </SelectTrigger>
                <SelectContent>
                  {OS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Right: Server / protocol settings */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" /> Server & Protocol
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="vpn-server">Server IP / Hostname *</Label>
              {settingsLoading ? (
                <div className="flex items-center gap-2 h-9 text-muted-foreground text-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading from settings…
                </div>
              ) : (
                <Input
                  id="vpn-server"
                  data-testid="input-vpn-server"
                  placeholder={defaultServerIp || "e.g. 104.245.246.110"}
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                />
              )}
              {defaultServerIp && !serverIp && (
                <p className="text-[11px] text-muted-foreground">
                  Using <span className="font-mono text-blue-400">{defaultServerIp}</span> from Settings. Override above to use a different address.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vpn-port">Port</Label>
                <Input
                  id="vpn-port"
                  data-testid="input-vpn-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 1194)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Protocol</Label>
                <Select value={proto} onValueChange={(v) => setProto(v as "udp" | "tcp")}>
                  <SelectTrigger data-testid="select-vpn-proto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROTO_OPTIONS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vpn-ping">Keep-alive ping (s)</Label>
                <Input
                  id="vpn-ping"
                  data-testid="input-vpn-ping"
                  type="number"
                  min={5}
                  max={60}
                  value={keepaliveInterval}
                  onChange={(e) => setKeepaliveInterval(parseInt(e.target.value, 10) || 10)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vpn-timeout">Restart timeout (s)</Label>
                <Input
                  id="vpn-timeout"
                  data-testid="input-vpn-timeout"
                  type="number"
                  min={30}
                  max={600}
                  value={keepaliveTimeout}
                  onChange={(e) => setKeepaliveTimeout(parseInt(e.target.value, 10) || 120)}
                />
              </div>
            </div>

            {/* TLS auth toggle */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
              <button
                type="button"
                data-testid="toggle-vpn-tls"
                onClick={() => setUseTLS(!useTLS)}
                className={cn(
                  "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                  useTLS ? "bg-blue-600" : "bg-muted"
                )}
              >
                <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200", useTLS ? "translate-x-4" : "translate-x-0")} />
              </button>
              <div>
                <p className="text-sm font-medium flex items-center gap-1"><Lock className="w-3 h-3" /> Include TLS-auth</p>
                <p className="text-[11px] text-muted-foreground">Enable if your VPN server uses HMAC firewall (ta.key)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generate button */}
      <Button
        data-testid="button-generate-ovpn"
        size="lg"
        className="bg-blue-600 hover:bg-blue-700 text-white w-full md:w-auto"
        disabled={!canGenerate}
        onClick={handleGenerate}
      >
        <Download className="w-4 h-4 mr-2" />
        Generate & Download .ovpn
      </Button>

      {!canGenerate && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          Enter a team member name to enable generation.
        </p>
      )}

      {/* OS-specific setup instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Terminal className="w-4 h-4 text-purple-400" />
            Setup Instructions — {OS_OPTIONS.find(o => o.value === os)?.label}
          </CardTitle>
          <CardDescription className="text-xs">Tool required: {osInfo.tool}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {osInfo.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 text-[11px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Admin Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {[
              "OpenVPN server is installed and running on the Sippy host",
              "A CA certificate (ca.crt) has been generated for the VPN",
              "A client certificate + key pair has been generated for this team member",
              "If using TLS-auth: ta.key has been generated and shared securely",
              "The VPN port (default 1194) is open in the Sippy server's firewall",
              "The generated .ovpn file + cert files are sent to the team member via secure channel",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <Wifi className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-400/60" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
