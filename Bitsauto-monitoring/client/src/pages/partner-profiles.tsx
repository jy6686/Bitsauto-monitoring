import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheck, Plus, Copy, Eye, EyeOff, ToggleLeft, Trash2, ExternalLink } from "lucide-react";

interface PartnerProfile {
  id: number; clientName: string; companyDisplayName?: string; contactEmail?: string;
  accessCodePrefix: string; logoUrl?: string; welcomeMessage?: string; active: boolean;
  lastLoginAt?: string; createdAt: string;
}

const createSchema = z.object({
  clientName:         z.string().min(1, "Required — must match the client name used in invoices/disputes"),
  companyDisplayName: z.string().optional(),
  contactEmail:       z.string().email("Invalid email").optional().or(z.literal("")),
  logoUrl:            z.string().url().optional().or(z.literal("")),
  welcomeMessage:     z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

export default function PartnerProfilesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState<{ code: string; clientName: string } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: profiles = [], isLoading } = useQuery<PartnerProfile[]>({
    queryKey: ["/api/partner-profiles"],
    queryFn: () => apiRequest("GET", "/api/partner-profiles").then(r => r.json()),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { clientName: "", companyDisplayName: "", contactEmail: "", logoUrl: "", welcomeMessage: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/partner-profiles"] });

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) => apiRequest("POST", "/api/partner-profiles", data).then(r => r.json()),
    onSuccess: (d) => {
      invalidate(); setCreateOpen(false); form.reset();
      setNewCode({ code: d.accessCode, clientName: d.profile.clientName });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/partner-profiles/${id}`, { active }).then(r => r.json()),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/partner-profiles/${id}`, {}),
    onSuccess: () => { invalidate(); setDeleteId(null); toast({ title: "Profile deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/partner-profiles/${id}/regenerate-code`, {}).then(r => r.json()),
    onSuccess: (d) => { invalidate(); setNewCode({ code: d.accessCode, clientName: d.profile.clientName }); },
    onError: (e: any) => toast({ title: "Regenerate failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />Partner Portal Access
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage client access codes for the read-only partner portal
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/portal/login" target="_blank" rel="noopener noreferrer" data-testid="link-portal-preview">
              <ExternalLink className="h-4 w-4 mr-1.5" />Preview Portal
            </a>
          </Button>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-profile">
            <Plus className="h-4 w-4 mr-1.5" />New Profile
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Contact Email</TableHead>
                <TableHead>Code Prefix</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && profiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <ShieldCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-muted-foreground">No partner profiles yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Create a profile to give a client portal access</p>
                  </TableCell>
                </TableRow>
              )}
              {profiles.map(p => (
                <TableRow key={p.id} data-testid={`row-profile-${p.id}`}>
                  <TableCell className="font-medium text-sm">{p.clientName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.companyDisplayName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.contactEmail ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">{p.accessCodePrefix}…</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch checked={p.active} data-testid={`toggle-active-${p.id}`}
                      onCheckedChange={v => toggleMutation.mutate({ id: p.id, active: v })} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`button-regen-${p.id}`}
                        onClick={() => regenerateMutation.mutate(p.id)}>
                        Regen Code
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400" data-testid={`button-delete-${p.id}`}
                        onClick={() => setDeleteId(p.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Partner Profile</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
              <FormField control={form.control} name="clientName" render={({ field }) => (
                <FormItem><FormLabel>Client Name <span className="text-red-400">*</span></FormLabel>
                  <FormControl><Input data-testid="input-client-name" placeholder="e.g. Acme Corp" {...field} /></FormControl>
                  <FormDescription className="text-xs">Must exactly match the client name used in invoices and disputes</FormDescription>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="companyDisplayName" render={({ field }) => (
                <FormItem><FormLabel>Display Name</FormLabel>
                  <FormControl><Input data-testid="input-display-name" placeholder="Shown in portal header" {...field} /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="contactEmail" render={({ field }) => (
                <FormItem><FormLabel>Contact Email</FormLabel>
                  <FormControl><Input data-testid="input-contact-email" type="email" placeholder="partner@example.com" {...field} /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="welcomeMessage" render={({ field }) => (
                <FormItem><FormLabel>Welcome Message</FormLabel>
                  <FormControl><Input data-testid="input-welcome-message" placeholder="Optional greeting shown on dashboard" {...field} /></FormControl>
                  <FormMessage /></FormItem>
              )} />
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create & Generate Code"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* New Code Display Dialog */}
      <Dialog open={newCode != null} onOpenChange={() => { setNewCode(null); setShowCode(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" />Access Code Generated</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-400/5 border border-emerald-400/20 p-4">
              <p className="text-xs text-muted-foreground mb-2">Access code for <strong>{newCode?.clientName}</strong></p>
              <div className="flex items-center gap-2">
                <code className={`flex-1 text-lg font-mono tracking-widest ${showCode ? "" : "blur-sm select-none"}`}>
                  {newCode?.code}
                </code>
                <button onClick={() => setShowCode(!showCode)} className="text-muted-foreground hover:text-foreground">
                  {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button onClick={() => { navigator.clipboard.writeText(newCode?.code ?? ""); toast({ title: "Copied to clipboard" }); }}
                  className="text-muted-foreground hover:text-foreground" data-testid="button-copy-code">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded px-3 py-2">
              Save this code now — it cannot be retrieved again. Share it securely with your partner contact.
            </p>
            <Button className="w-full" onClick={() => { setNewCode(null); setShowCode(false); }}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Partner Profile?</AlertDialogTitle>
            <AlertDialogDescription>This will revoke portal access immediately. The client will no longer be able to log in.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
