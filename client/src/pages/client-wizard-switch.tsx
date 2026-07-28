/**
 * Rollout switch for /client-wizard.
 *
 * Serves the Customer Preparation Wizard 2.0 when the platform flag
 * `customer_preparation_wizard_v2` is on, otherwise the production-certified legacy
 * wizard. Both remain reachable directly (/client-wizard-v2, /client-wizard-legacy) so a
 * comparison never requires toggling a flag.
 *
 * While the flag is loading we render LEGACY, not a spinner: this is a live onboarding
 * workflow, and a flash of empty state — or worse, briefly showing the wrong wizard
 * mid-onboarding — is a real cost. Defaulting to the certified path while uncertain is
 * the same principle the freeze itself encodes.
 */
import { useQuery } from "@tanstack/react-query";
import ClientWizardPage from "@/pages/client-wizard";
import ClientWizardV2Page from "@/pages/client-wizard-v2";

interface PlatformFlag { key: string; enabled: boolean }

export default function ClientWizardSwitch() {
  const { data: flags } = useQuery<PlatformFlag[]>({
    queryKey: ["/api/platform/flags"],
    staleTime: 5 * 60_000,
  });

  const v2 = flags?.find(f => f.key === "customer_preparation_wizard_v2")?.enabled === true;
  return v2 ? <ClientWizardV2Page /> : <ClientWizardPage />;
}
