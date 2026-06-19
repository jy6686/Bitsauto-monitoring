# How to Create a Sippy Account via IchiBaan Monitoring Portal
### Complete Step-by-Step Team Reference Guide

---

## Overview

The **New Sippy Account** wizard in the IchiBaan Monitoring portal allows you to create a full SIP customer or vendor account directly on your Sippy Softswitch — without logging into Sippy itself. The wizard has **4 steps** and takes roughly 2–3 minutes to complete.

> **Prerequisite:** Admin API credentials must be configured in **Settings → Sippy Admin API Credentials** before the wizard can create real SIP accounts. If only portal (self-care) credentials are set, the wizard will warn you and create only a portal sub-account — not a true SIP account.

---

## How to Open the Wizard

1. Log in to the IchiBaan Monitoring portal.
2. In the left sidebar, click **Client / Vendor** (under the Clients & Vendors group).
3. On the page, locate the **"New Sippy Account"** button (top-right area of the Sippy Accounts tab).
4. Click it — the 4-step wizard will open as a modal dialog.

---

## Step 1 — Basic Info

This step collects the account identity and credentials.

---

### Section: Sippy Switch Connection

| Field | Required | Description |
|---|---|---|
| **Target Sippy Switch** | Yes (if multiple switches configured) | Select which Sippy switch to create this account on. If only one switch is connected via Settings, it is used automatically. If no switch is configured, you must enter inline credentials (see below). |

**If no switch is pre-configured in Settings**, an inline credentials panel appears:

| Field | Required | Description |
|---|---|---|
| **Sippy URL** | Yes | Full URL of your Sippy server, e.g. `https://191.101.30.107` |
| **Admin Username** | Yes | Sippy admin API username (not the portal self-care username) |
| **Admin Password** | Yes | Sippy admin API password |

---

### Section: Account Identity

| Field | Required | Default / Notes |
|---|---|---|
| **Display Name** | **Yes** | The account's primary name shown everywhere in the portal and Sippy, e.g. `Acme Telecom`. This is the only mandatory field in the entire wizard. |
| **Account Type** | No | `Client (Customer)` or `Vendor (Carrier)`. Default: **Client**. Use Vendor for carriers/upstream termination providers. |
| **Company Name** | No | Auto-filled from Display Name. Override if the billing/company name differs. |
| **First Name** | No | Auto-derived from Display Name (first word). Override if needed. |
| **Last Name** | No | Optional. Useful for individual account holders. |
| **Email** | No | Contact email for the account holder, e.g. `contact@acme.com`. Used for portal notifications. |
| **Country** | No | Two-letter country code, e.g. `US`, `GB`, `AE`. |
| **Phone** | No | Contact phone number, e.g. `+1 555 000 0000`. |
| **Fax** | No | Fax number if applicable. |
| **Description** | No | Free-text internal notes about this account. |

---

### Section: Portal & SIP Credentials

| Field | Required | Default / Notes |
|---|---|---|
| **Self-Care Username** | No | The username the customer uses to log in to the Sippy self-care portal. Leave blank — it will be auto-derived from the Display Name (lowercased, non-alphanumeric chars stripped). |
| **Portal Password** | No | The customer's self-care portal login password. Leave blank to auto-generate a secure password. You can toggle visibility with the eye icon. The generated password is shown on the success screen — **save it immediately**. |
| **SIP Authname** | No | The SIP authentication username used in `REGISTER` and `INVITE` requests. Auto-filled from Display Name. Override by typing — once edited manually it will no longer auto-update. |
| **SIP Password** | No | The SIP account password. Auto-generated (12-character mixed-case + digits + special chars). Click the **↻** icon to regenerate. The generated password is shown on the success screen — **save it immediately**. |

> **Tip:** You do not need to fill in passwords — the system generates secure ones automatically and shows them to you after the account is created.

Click **Next →** to proceed. The button is disabled until Display Name is filled.

---

## Step 2 — Network & Routing

This step controls how calls are routed and billed.

---

### Section: Routing & Service Plan

| Field | Required | Default / Notes |
|---|---|---|
| **Routing Group** | No | Select the Sippy routing group this account belongs to. If routing groups are loaded from Sippy, a dropdown appears. Otherwise enter the numeric routing group ID. Leave blank to auto-select the first available group. |
| **Billing / Service Plan** | **Yes** | Select the Sippy service plan (tariff) to apply to this account. The dropdown is populated live from Sippy. If plans do not appear, click the **Refresh** button next to the label. Service plans must be created in Sippy portal first under **Customers → Tariffs & Currencies → Service Plans**. |
| **Rate / Min ($)** | No | Per-minute rate applied to calls from this account, e.g. `0.0050`. Leave blank for the default rate from the service plan. |
| **Max Session Time (sec)** | No | Maximum duration of a single call in seconds, e.g. `3600` (1 hour). Leave blank or `0` for no limit. |

> **About Billing Plans:** Plans are fetched live from Sippy. If the list is empty or outdated, use the **Refresh** button. The system will auto-match a plan by name if a name match is found; otherwise select manually from the dropdown.

---

### Section: Translation Rules

Translation rules are Perl-compatible regex substitution expressions applied to call numbers.

| Field | Required | Default / Notes |
|---|---|---|
| **CLI Translation Rule** | No | Regex applied to the caller ID (CLI/ANI) before routing, e.g. `s/^/+/` adds a leading `+`. Leave blank to apply no transformation. |
| **CLD Translation Rule** | No | Regex applied to the called number (CLD/DNIS) before routing, e.g. `s/^0//` strips a leading `0`. Leave blank to apply no transformation. |

Click **Next →** to continue.

---

## Step 3 — SIP Configuration

This step controls codec preferences, SIP behaviour flags, P-Asserted-Identity handling, and localisation.

---

### Section: Codec & Media

| Field | Required | Default / Notes |
|---|---|---|
| **Preferred Codec** | No | The codec Sippy will prefer for this account's calls. Options: `Disabled (no preference)`, `G.711u (PCMU)`, `G.711a (PCMA)`, `G.729`, `G.722`, `GSM`, `G.723`, `G.728`. Default: **Disabled** (no preference — Sippy negotiates). |
| **Use Preferred Codec Only** | No | Checkbox. If checked, Sippy will reject calls that cannot use the selected codec. Only enable if you know the remote endpoint supports it. Default: **unchecked**. |

---

### Section: SIP Behaviour

| Field | Required | Default | Description |
|---|---|---|---|
| **Allow SIP Registration** | No | Checked | Permits the SIP device/softphone to register to Sippy using this account's credentials. Disable for IP-authenticated trunks that don't need to register. |
| **Trust CLI (caller ID)** | No | Unchecked | If checked, Sippy trusts the caller ID sent by this account without verification. Enable for trusted upstream carriers. |
| **Disallow Loop Calls** | No | Unchecked | If checked, Sippy rejects any call that would be routed back to this same account (prevents routing loops). |
| **Pass P-Asserted-Identity** | No | Unchecked | If checked, Sippy forwards the P-Asserted-Identity (PAI) header from/to this account. Used for verified identity in carrier interconnects. |

---

### Section: P-Asserted-ID Translation Rule

| Field | Required | Default / Notes |
|---|---|---|
| **P-Asserted-ID Translation Rule** | No | A short regex or code applied to the PAI header — typically a 4-digit code. Auto-generated by the system. Click **Regenerate 4-digit** to get a new code. This field is only active when **Pass P-Asserted-Identity** is enabled. |

---

### Section: Localisation

| Field | Required | Default / Notes |
|---|---|---|
| **Currency** | No | The billing currency for this account. A dropdown is populated from Sippy's configured currencies. Default: **USD**. If currencies don't load, type the currency code manually, e.g. `USD`, `EUR`, `GBP`. |
| **Time Zone** | No | The time zone used for CDRs and self-care portal display. A dropdown is populated from Sippy. Default: **GMT+00 (UTC)** — ID `0`. Select the customer's local timezone. |

Click **Next →** to continue.

---

## Step 4 — Billing & Alerts

This step sets financial limits and configures low-balance email alerts.

---

### Section: Billing & Limits

| Field | Required | Default / Notes |
|---|---|---|
| **Credit Limit ($)** | No | Maximum debt the account is allowed to accumulate before calls are blocked. `0` = no credit (prepaid only). Leave blank for no limit. |
| **Starting Balance ($)** | No | The initial balance loaded onto the account at creation, e.g. `50.00`. Default: `0.00`. |
| **Max Concurrent Sessions** | No | Maximum number of simultaneous active calls allowed for this account. `0` = unlimited. |
| **Max CPS** | No | Maximum calls per second (call rate limit). Leave blank for unlimited. Useful for preventing traffic bursts. |
| **Account Lifetime (days)** | No | How long the account stays active after creation. `-1` = unlimited (never expires). `0` or positive integer = expires in that many days. Default: **-1** (unlimited). |

---

### Section: Low Balance Alerts

| Field | Required | Default / Notes |
|---|---|---|
| **Balance Threshold ($)** | No | When the account balance drops below this amount, an alert email is sent. Leave blank to disable alerts entirely. Example: `10.00` |
| **Alert Email (To)** | No | Primary email address to receive the low-balance alert, e.g. `billing@acme.com`. |
| **Alert Email (CC)** | No | Carbon-copy email address for the alert, e.g. `manager@acme.com`. |

---

## Final Step — Creating the Account

After filling in all desired fields across all 4 steps:

1. Review your entries on Step 4.
2. Click the **"Create on Sippy"** button (bottom-right of the dialog).
3. The button will show a spinning loader while the account is being created.
4. **On success:** A green banner appears showing a confirmation message. A credentials box is displayed with:
   - **Self-care login** — the portal username
   - **Portal password** — save this now, it will not be shown again
   - **SIP authname** — the SIP authentication username
   - **SIP password** — save this now, it will not be shown again
5. **On error:** A red banner appears with the error message and detail. Fix the issue and try again.

> **Important:** Copy the credentials shown in the success banner immediately. Once you close the dialog, the passwords are not stored or retrievable from the portal.

Click **Close** to dismiss the wizard.

---

## Quick Reference: All Fields at a Glance

| Step | Field | Required | Auto-filled? |
|---|---|---|---|
| 1 | Target Sippy Switch | Yes* | — |
| 1 | Display Name | **Yes** | — |
| 1 | Account Type | No | Client |
| 1 | Company Name | No | From Display Name |
| 1 | First Name | No | From Display Name |
| 1 | Last Name | No | — |
| 1 | Email | No | — |
| 1 | Country | No | — |
| 1 | Phone | No | — |
| 1 | Fax | No | — |
| 1 | Description | No | — |
| 1 | Self-Care Username | No | From Display Name |
| 1 | Portal Password | No | Auto-generated |
| 1 | SIP Authname | No | From Display Name |
| 1 | SIP Password | No | Auto-generated |
| 2 | Routing Group | No | First available |
| 2 | Billing / Service Plan | **Yes** | Auto-matched by name |
| 2 | Rate / Min ($) | No | — |
| 2 | Max Session Time (sec) | No | — |
| 2 | CLI Translation Rule | No | — |
| 2 | CLD Translation Rule | No | — |
| 3 | Preferred Codec | No | Disabled |
| 3 | Use Preferred Codec Only | No | Unchecked |
| 3 | Allow SIP Registration | No | Checked |
| 3 | Trust CLI | No | Unchecked |
| 3 | Disallow Loop Calls | No | Unchecked |
| 3 | Pass P-Asserted-Identity | No | Unchecked |
| 3 | P-Asserted-ID Translation Rule | No | Auto-generated 4-digit |
| 3 | Currency | No | USD |
| 3 | Time Zone | No | UTC (GMT+00) |
| 4 | Credit Limit ($) | No | 0 |
| 4 | Starting Balance ($) | No | 0.00 |
| 4 | Max Concurrent Sessions | No | Unlimited |
| 4 | Max CPS | No | Unlimited |
| 4 | Account Lifetime (days) | No | -1 (unlimited) |
| 4 | Balance Threshold ($) | No | — (disabled) |
| 4 | Alert Email (To) | No | — |
| 4 | Alert Email (CC) | No | — |

*Required only when multiple Sippy switches are configured.

---

## Common Issues & Tips

| Issue | Solution |
|---|---|
| **Billing plans dropdown is empty** | Click the **Refresh** button next to the "Billing / Service Plan" label to reload plans live from Sippy. |
| **Warning: "Portal sub-account created — not a full SIP account"** | Admin API credentials are missing. Go to **Settings → Sippy Admin API Credentials** and add them, then try again. |
| **Account creation fails with auth error** | Check that the Sippy admin username and password in Settings are correct and have sufficient permissions. |
| **Service plan not found** | The plan must be created in Sippy first: **Sippy portal → Customers → Tariffs & Currencies → Service Plans**. Refresh the list after creating it. |
| **Credentials not visible after closing** | The passwords are shown only once in the success banner. Always copy them before clicking Close. |

---

*Document generated from IchiBaan Monitoring Portal — clients.tsx wizard (Steps 1–4)*
*Last updated: May 2026*
