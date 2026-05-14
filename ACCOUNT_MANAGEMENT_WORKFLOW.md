# Account Management Workflow & Operations Script
## Bitsauto Monitoring Platform — Internal Reference

**Document Version:** 1.0  
**Scope:** Company Creation Wizard · Client Account Wizard · IP Approval Flow · Sippy Integration  
**Generated:** May 2026  
**Classification:** Internal Operations — Do Not Distribute

---

## 1. Overview & Philosophy

The Account Management module follows a strict two-phase approach:

| Phase | What happens | System it touches |
|---|---|---|
| Phase A — Company | Create the legal/commercial entity in BitsAuto | BitsAuto database only |
| Phase B — Client Account | Create the live SIP account on the Sippy switch | Sippy XML-RPC + BitsAuto |

**Critical Rule — i_customer = 1 (Root), NEVER i_customer = 2 (RTST1)**

All new client accounts MUST be created under `i_customer = 1` (the ssp-root customer). Accounts created under `i_customer = 2` (RTST1) inherit RTST1's routing group, which causes:
- **"No Route Found"** errors on outbound calls
- **make2WayCallback failures** (wrong credential scope)
- Inability to assign independent billing plans

---

## 2. Phase A — Company Creation (3-Step Wizard)

**Path:** Settings → Account Management → New Company (`/company/create`)

---

### Step A1 — Basic Information

| Field | Required | Notes |
|---|---|---|
| Company Name | YES | Must be unique. Used as primary identifier across all reports. |
| Short Code | YES | 3–8 capital letters. Auto-prefixes User IDs in Step B1. E.g. `ACME` → user `acme01`. |
| Country | No | Used for timezone defaults and invoice headers. |
| KAM | YES | Key Account Manager. Select from active BitsAuto team members. |
| Status | YES | `active` or `inactive`. Inactive companies cannot have new client accounts created. |
| Company Type | YES | `retail` — individual/SME client. `wholesale` — carrier/reseller/interconnect partner. |
| Contract Type | YES | `bilateral` — both client and vendor. `client` — buying traffic only. `vendor` — selling traffic only. |
| Department | YES | Maps to internal BitsAuto department routing (retail / wholesale / enterprise / carrier / reseller). |
| Team | No | Sub-team within the department (optional). |
| Client Timezone | No | Timezone for client-facing reports and invoice dates. |
| Vendor Timezone | No | Timezone for vendor-facing CDR and billing. |
| Currency | YES | Default: USD. Affects invoice generation and balance display. |

**Validation Rules:**
- Company Name and Short Code must be globally unique — system rejects duplicates with HTTP 409
- Short Code is automatically uppercased on input

---

### Step A2 — Billing Information

#### Vendor Billing (what we pay the carrier/vendor)

| Field | Default | Notes |
|---|---|---|
| Vendor Billing Cycle | Weekly Cutoff | `weekly_cutoff` / `monthly` / `daily` / `bi_weekly` |
| Vendor Grace Period | 3 days | Days after cycle end before overdue status triggers |
| Vendor Credit Limit | 0 | Maximum outstanding amount before account suspension |
| Dispute Over % | 0 | Auto-flag disputes when variance exceeds this percentage |

#### Client Billing (what the client pays us)

| Field | Default | Notes |
|---|---|---|
| Client Billing Cycle | Weekly Cutoff | Same options as vendor |
| Client Grace Period | 3 days | Days before the client account triggers low-balance alert |
| Client Credit Limit | 0 | Credit extended to the client (postpaid only) |
| Dispute Over Value | 0 | Auto-flag client disputes above this absolute amount |
| Payment Term | prepaid | `prepaid` / `postpaid` / `credit` |

#### Legal & Invoice

| Field | Notes |
|---|---|
| Legal Name — Client Invoice | Full legal entity name as it appears on invoices sent to the client |
| Legal Name — Vendor Invoice | Full legal entity name as it appears on invoices received from the vendor |
| Invoice Email | Primary recipient for automated invoice emails |

---

### Step A3 — Contacts & Bank

#### Contact Types

Four contact categories, each supporting multiple entries:

| Type | Purpose |
|---|---|
| Technical | SIP engineers, NOC contacts, escalation path for network issues |
| Finance | Accounts payable/receivable, billing disputes |
| Commercial | Sales, account growth, rate negotiation |
| Billing | Invoice recipients, PO references |

**Required fields per contact:** First Name, Email  
**Optional:** Last Name, Phone, Fax

#### Bank Account Fields

| Field | Required |
|---|---|
| Bank Name | YES |
| Account Title | YES |
| Account Number | YES |
| SWIFT Code | YES |
| IBAN | No |
| Currency | YES (default USD) |
| Country | YES |
| Address | No |
| Remarks | No |

Multiple bank accounts can be added (e.g. USD account + GBP account for the same company).

---

## 3. Phase B — Client Account Wizard (7-Step)

**Path:** Account Management → New Client (`/client/wizard`)

**Pre-requisite:** The company must already exist in BitsAuto (Phase A complete).

---

### Step B1 — Department & Company

| Field | Required | Notes |
|---|---|---|
| Department | YES | Filters the company dropdown to show only relevant companies |
| Company | YES | Select the BitsAuto company created in Phase A |
| User ID | YES | The SIP username on Sippy. Auto-populated from company short code (lowercase). Can be overridden. Must be globally unique on the switch. |
| Password | YES | SIP auth password and web portal password. Auto-generated (12 chars, mixed case + symbols). Can be re-generated with one click. |
| Notification Email (To) | No | Low balance alerts, rate sheet emails, system notifications |
| Notification Email (CC) | No | Secondary recipient for all notifications |
| Balance Threshold Alert | No | Numeric value (in account currency). Alert fires when prepaid balance drops below this. |
| A2Z Notification | No | Whether to send A2Z rate sheet emails automatically |
| Rate Sheet Notification | No | Format of rate sheet to send: `full_sheet`, `partial_update`, `a2z` |

**Critical note on User ID:**  
The User ID becomes the `authname` in Sippy. This is what appears in CDRs, billing reports, and routing logs. Choose a meaningful, stable identifier — changing it after creation requires a full account update.

---

### Step B2 — Rate Sheet Configuration

| Field | Default | Notes |
|---|---|---|
| Invoice Template | Standard | Layout template for generated PDF invoices |
| Full Rate Sheet Format | Full CSV | Format sent for complete rate sheet distribution |
| Partial Rate Sheet Format | Partial Update | Format for partial/updated rates only |
| A2Z Rate Sheet Format | A2Z | Format for A-to-Z destination list |
| Dialcode Format | E.164 | `E.164` (+44...) / `National` (044...) / `Local` (44...) |
| Prefix Style | with_plus | Whether to include `+` prefix in rate sheet dial codes |

---

### Step B3 — Technical Configuration (Per Trunk)

One or more trunks can be configured. Each trunk represents a logical traffic lane (e.g. "SB-1 PREMIUM", "SB-1 STANDARD").

| Field | Required | Notes |
|---|---|---|
| Trunk / Switch Name | No | Descriptive label (e.g. "SB-1 PREMIUM"). Not sent to Sippy — BitsAuto display only. |
| **Default Routing Group** | **YES** | **The most critical field. Must be set explicitly.** Leaving it blank means the account inherits from its parent customer (RTST1 at i_customer=2), which causes "No Route Found". |
| Max Call Time (seconds) | No | Default: 3600 (1 hour). Hard cap on any single call duration. |
| Max Sessions | No | Default: 0 (unlimited). Set to limit concurrent calls. |
| Max CPS | No | Calls per second limit. Leave blank for unlimited. |
| Preferred Codec | No | G.711u, G.711a, G.722, G.729, GSM, G.723, G.728. Default: None/Disabled. |
| Use Preferred Codec Only | No | If checked, rejects calls that cannot use the preferred codec |
| Media Relay Type | No | Default / Always Relay / Never Relay |
| CLD Translation Rule | No | Regex substitution applied to called number. Default: `s/^//` (no-op). |
| Prevent Call Loops | No | Blocks calls that would route back through the originating account |
| Allow Registration | No | Default: on. Uncheck for IP-auth-only accounts |
| Blocked | No | Hard-blocks the account on Sippy immediately |

**Why Routing Group is mandatory — the technical explanation:**

```
Sippy routing resolution order:
  1. Account-level routing group (i_routing_group on the account)
  2. Customer-level routing group (i_routing_group on i_customer)
  3. System default

If the account has no routing group:
  → Falls through to the customer's routing group
  → New accounts with i_customer=1 inherit root routing group (usually empty)
  → Root customer has no routing group set by default
  → Result: "No Route Found" on every call

Fix: Always set routing group at account level during creation.
```

---

### Step B4 — IPs & Trunk Assignment

#### IP Address Entry

| Field | Required | Notes |
|---|---|---|
| IP Address | YES | IPv4 or CIDR notation (e.g. 192.168.1.1 or 10.0.0.0/24) |
| Trunk | No | Which trunk this IP is associated with |
| Description | No | Descriptive label (e.g. "Primary Media Server", "Backup SBC") |

**Each IP must be submitted for approval before authentication rules can be created.**

After filling in an IP row, click **"Submit"** to send it to the approval queue. The IP status becomes **Pending** until an admin approves it in the Approval Queue page.

#### IP Approval States

| Status | Meaning | Auth Rule Creation |
|---|---|---|
| Pending | Awaiting admin review | Blocked |
| Approved | Admin has verified the IP | Allowed |
| Rejected | Admin has rejected the IP | Blocked — must resubmit |

#### Trunk Assignment Checkboxes

Select which product trunks (PREMIUM, STANDARD PLUS, STANDARD, BUSINESS, CHARLIE) this client is allowed to use. Used for rate sheet filtering and CDR classification.

---

### Step B5 — Authentication Rules (Gated — Approved IPs Only)

**This step is locked until at least one IP has been approved.**

Auth rules define how Sippy authenticates incoming SIP traffic from this account.

| Field | Options | Notes |
|---|---|---|
| Trunk | PREMIUM / STANDARD PLUS / STANDARD / BUSINESS / CHARLIE | Which trunk this rule applies to |
| IP Address | Dropdown — approved IPs only | Source IP Sippy will accept traffic from |
| Auth Type | IP Auth / SIP Digest / Both | `IP Auth` — trust any call from this IP. `SIP Digest` — require SIP username+password. `Both` — require IP match AND digest. |
| Tech Prefix | Optional | Numeric prefix stripped from CLD before routing (e.g. `101`) |
| CLI Rule | Optional | Regular expression applied to CLI/ANI for validation |
| Trust CLI | Checkbox | If checked, CLI from this source is trusted without verification |

**Standard configuration for IP-auth-only clients:**
- Auth Type: `IP Auth`
- Tech Prefix: blank (or agreed prefix)
- Trust CLI: checked if client sends clean CLI

---

### Step B6 — Validation Rules (Optional)

Validation rules restrict which numbers can be called through this account.

| Rule Type | Pattern Example | Action |
|---|---|---|
| CLI Format | `^\+44\d{10}$` | Block calls with non-UK CLI |
| CLD Prefix | `^00` | Block calls to numbers starting with 00 |
| Geo Block | `^+1900` | Block calls to premium-rate numbers |
| Time Window | `08:00-18:00` | Only allow calls in office hours |
| Max Attempts | `5` | Block after 5 failed attempts per minute |

Actions available: **Block** (reject the call), **Allow Only** (whitelist mode — block everything except matches), **Flag** (allow but tag in CDR for review).

---

### Step B7 — Review & Submit

A summary of all configuration is displayed. Review:
- Company and department
- User ID (this is permanent — confirm spelling)
- Customer context confirmation: `i_customer = 1 (Root — not under RTST1)`
- Per-trunk routing group assignments
- IP submission status (all IPs must be approved before submit is enabled)

**Submit button is disabled if:**
- Any IP is still in Pending status
- User ID is blank
- Any trunk has no routing group selected

On submit, the wizard calls `/api/client-wizard/submit` which:
1. Calls Sippy `createAccount()` XML-RPC with `i_customer = 1`
2. Sets routing group, max sessions, codec preferences
3. Returns the new Sippy `iAccount` ID
4. Displays the Post-Creation Checklist

---

## 4. Post-Creation Checklist

After the wizard completes, the following steps must be performed:

| Step | Automated | Action Required |
|---|---|---|
| Company record exists in BitsAuto | YES | Auto-created in Phase A |
| Client account created in Sippy (i_customer=1) | YES | Done by wizard on submit |
| Added to BitsAuto monitoring | YES | Auto-detected on next CDR/live-call cycle |
| Verify routing group has active vendor connections | NO | Check Routing Manager → Routing Groups — confirm the group has vendors attached |
| Confirm rate sheet delivered to client email | NO | Check Email Centre → Sent Items |
| Run test call from new account | NO | Use Test Call Launcher → enter new account's User ID as originator |
| Check CDR after test call | NO | CDR Viewer → filter by account name — confirm call recorded with correct tariff |
| Confirm balance threshold alerts working | NO | Temporarily set threshold above current balance → verify alert fires |

---

## 5. IP Approval Flow — Detailed

### Submission (Step B4 of wizard)

```
POST /api/client-ip-requests
{
  clientName: "Acme Corp",
  companyId: 12,
  ipAddress: "203.0.113.45",
  trunk: "PREMIUM",
  description: "Primary London SBC"
}
```

Response: `{ request: { id, status: "pending", ... } }`

### Review (Approval Queue page)

Path: `/approvals`

The IP request appears as a pending item. An admin can:
- **Approve** → `PATCH /api/client-ip-requests/:id/approve`
  - Sets status to `approved`, records reviewer and timestamp
  - Immediately unlocks Step B5 (Auth Rules) for this IP
- **Reject** → `PATCH /api/client-ip-requests/:id/reject`
  - Sets status to `rejected`, stores rejection reason
  - Operator must resubmit a corrected IP

### Auth Rule Creation (Step B5 — post-approval)

Auth rules are created in Sippy only after the account is live (post-submit). During the wizard, they are captured as configuration intent. Implementation:

```
Sippy XML-RPC: account.addAuthRule
Parameters:
  i_account: <newly created account ID>
  i_protocol: 1 (SIP)
  i_ip: <approved IP address>
  i_auth_type: <0=IP, 1=Digest, 2=Both>
  tech_prefix: <tech prefix if set>
```

---

## 6. Sippy API Reference — Account Creation

### Primary Method: createAccount()

**XML-RPC endpoint:** `POST https://<sippy-host>/xmlapi/xmlapi`  
**Auth:** HTTP Digest Authentication with admin credentials  
**Credentials scope:** ssp-root level (i_customer = 1)

**Key parameters used by the wizard:**

```xml
<methodCall>
  <methodName>createAccount</methodName>
  <params>
    <param><value><struct>
      <member><name>name</name><value><string>{userId}</string></value></member>
      <member><name>authname</name><value><string>{userId}</string></value></member>
      <member><name>password</name><value><string>{voipPassword}</string></value></member>
      <member><name>web_password</name><value><string>{webPassword}</string></value></member>
      <member><name>i_customer</name><value><int>1</int></value></member>
      <member><name>i_routing_group</name><value><int>{routingGroupId}</int></value></member>
      <member><name>max_sessions</name><value><int>{maxSessions}</int></value></member>
      <member><name>max_call_duration</name><value><int>{maxCallTime}</int></value></member>
      <member><name>preferred_codec</name><value><int>{codecId}</int></value></member>
      <member><name>use_preferred_codec_only</name><value><int>0|1</int></value></member>
      <member><name>disallow_loops</name><value><int>0|1</int></value></member>
      <member><name>reg_allowed</name><value><int>0|1</int></value></member>
      <member><name>cld_translation_rule</name><value><string>s/^//</string></value></member>
      <member><name>welcome_call_ivr</name><value><int>0</int></value></member>
      <member><name>on_payment_action</name><value><int>0</int></value></member>
    </struct></value></param>
  </params>
</methodCall>
```

**Required by Sippy (will return fault 501 "Fatal error" if missing):**
- `welcome_call_ivr` must be integer `0`, not null
- `on_payment_action` must be integer `0`, not null

### Codec ID Reference

| ID | Codec |
|---|---|
| 0 | G.711u (PCMU) |
| 8 | G.711a (PCMA) |
| 9 | G.722 |
| 18 | G.729 |
| 3 | GSM |
| 4 | G.723 |
| 15 | G.728 |

### Credential Pairing

The wizard uses the admin XML-RPC credentials:

```
sippyXmlCreds(settings) → { username: SIPPY_PROV_USERNAME, password: SIPPY_PROV_PASSWORD }
```

These are stored as Replit environment secrets (`SIPPY_PROV_USERNAME`, `SIPPY_PROV_PASSWORD`) and never logged or exposed.

---

## 7. Common Errors & Fixes

### Error: "No Route Found" on test call after account creation

**Cause:** Routing group was not set on the account. The account inherited from its parent customer which has no routing group.

**Diagnosis:**
1. Open Sippy → Accounts → find the account
2. Check `Default Routing Group` field — if blank, this is the cause

**Fix:**
1. In BitsAuto → Clients → find the account → Edit → set routing group
2. Or re-run the wizard (Edit Company path) and set the routing group

**Prevention:** The wizard enforces routing group selection and warns if it is blank.

---

### Error: make2WayCallback fails for accounts created under RTST1

**Cause:** `make2WayCallback` is scoped to the account's parent customer credentials. Accounts under `i_customer = 2` (RTST1) use RTST1's portal credentials for the callback, not admin credentials.

**Fix:** New accounts created via the wizard always use `i_customer = 1`. For legacy accounts under RTST1, move them to root using `account.updateAccount` with `i_customer: 1`.

---

### Error: HTTP 409 "Company name or short code already exists"

**Cause:** A company with the same name or short code already exists in BitsAuto.

**Fix:** Check the Companies list for existing entries. Use a more specific name or a different short code.

---

### Error: IP resubmission blocked ("IP already submitted and pending approval")

**Cause:** The same IP+clientName combination has a pending request.

**Fix:** Either wait for the pending request to be approved/rejected, or reject it from the Approval Queue first, then resubmit with corrected information.

---

### Error: Auth rules tab shows no approved IPs

**Cause:** All submitted IPs are still in Pending status.

**Fix:** Approve them from the Approval Queue (`/approvals`). The wizard auto-refreshes when IPs are approved.

---

## 8. Database Schema Reference

### companies

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | BitsAuto company ID |
| name | VARCHAR(256) UNIQUE | Display name |
| short_code | VARCHAR(32) UNIQUE | Prefix for user IDs |
| country | VARCHAR(64) | |
| kam | VARCHAR(128) | Key Account Manager username |
| status | VARCHAR(16) | active / inactive |
| company_type | VARCHAR(32) | retail / wholesale |
| contract_type | VARCHAR(32) | bilateral / client / vendor |
| department | VARCHAR(64) | retail / wholesale / enterprise / carrier / reseller |
| currency | VARCHAR(8) | USD / EUR / GBP etc. |
| vendor_billing_cycle | VARCHAR(32) | weekly_cutoff / monthly / daily / bi_weekly |
| client_billing_cycle | VARCHAR(32) | Same |
| payment_term | VARCHAR(32) | prepaid / postpaid / credit |
| legal_name_ci | VARCHAR(256) | Legal name on client invoices |
| legal_name_ven | VARCHAR(256) | Legal name on vendor invoices |
| invoice_email | VARCHAR(256) | |
| created_at | TIMESTAMP | Auto |
| created_by | VARCHAR(255) | BitsAuto username |

### company_contacts

| Column | Type |
|---|---|
| id | SERIAL PK |
| company_id | INTEGER (FK → companies.id) |
| contact_type | VARCHAR(32): technical / finance / commercial / billing |
| first_name | VARCHAR(128) |
| last_name | VARCHAR(128) |
| email | VARCHAR(256) |
| phone | VARCHAR(64) |
| fax | VARCHAR(64) |

### company_bank_accounts

| Column | Type |
|---|---|
| id | SERIAL PK |
| company_id | INTEGER (FK → companies.id) |
| bank_name | VARCHAR(256) |
| account_title | VARCHAR(256) |
| account_no | VARCHAR(128) |
| iban | VARCHAR(64) |
| swift_code | VARCHAR(32) |
| currency | VARCHAR(8) |
| country | VARCHAR(64) |
| address | TEXT |
| status | VARCHAR(16): active / inactive |

### client_ip_requests

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| company_id | INTEGER | Optional FK to companies.id |
| client_name | VARCHAR(256) | Company or account name |
| ip_address | VARCHAR(64) | IPv4 or CIDR |
| trunk | VARCHAR(128) | Associated trunk name |
| description | TEXT | |
| status | VARCHAR(16) | pending / approved / rejected |
| submitted_by | VARCHAR(255) | BitsAuto username |
| reviewed_by | VARCHAR(255) | Admin who approved/rejected |
| rejection_reason | TEXT | Only set if rejected |
| submitted_at | TIMESTAMP | Auto |
| reviewed_at | TIMESTAMP | Set on approve/reject |

---

## 9. API Route Reference

| Method | Path | Role Required | Description |
|---|---|---|---|
| GET | /api/companies | admin, management | List all companies |
| POST | /api/companies | admin, management | Create company (with contacts + bank accounts) |
| GET | /api/companies/:id | admin, management | Get single company |
| PUT | /api/companies/:id | admin, management | Update company |
| DELETE | /api/companies/:id | admin only | Delete company and all linked contacts/banks |
| GET | /api/client-ip-requests | admin, management | List all IP requests |
| POST | /api/client-ip-requests | admin, management | Submit IP for approval |
| PATCH | /api/client-ip-requests/:id/approve | admin only | Approve an IP |
| PATCH | /api/client-ip-requests/:id/reject | admin only | Reject an IP |
| POST | /api/client-wizard/submit | admin, management | Create account in Sippy (runs createAccount XML-RPC) |

---

## 10. Quick Reference — Full Workflow

```
Phase A — Company (10–15 min)
  1. Navigate to Account Management → New Company
  2. Step A1: Fill company name, short code, country, KAM, type, department, currency
  3. Step A2: Set billing cycles, grace periods, credit limits, payment terms, legal names
  4. Step A3: Add at minimum one Technical and one Finance contact. Add bank account if available.
  5. Click "Create Company" → record saved to BitsAuto DB.

Phase B — Client Account (15–30 min depending on IP approval speed)
  1. Navigate to Account Management → New Client
  2. Step B1: Select department, company, confirm user ID and password. Set notification email.
  3. Step B2: Confirm rate sheet format and invoice template.
  4. Step B3: Add trunk(s). MANDATORY: select routing group for every trunk.
             If routing group is unknown, check Routing Manager → Routing Groups first.
  5. Step B4: Add client IPs. Click "Submit" on each IP to queue for approval.
             Go to Approval Queue and approve the IPs (or ask an admin to do so).
  6. Step B5: Return after IPs are approved. Create auth rules using approved IPs.
             Set auth type (usually IP Auth), tech prefix if required, trust CLI if applicable.
  7. Step B6: Add validation rules if client has geographic or time restrictions.
  8. Step B7: Review all settings. Verify routing group is set for all trunks.
             Click "Create Client in Sippy".

Post-Creation (within 30 min of account creation):
  - Verify routing group vendor connections (Routing Manager → select the routing group)
  - Send rate sheet from Email Centre
  - Run test call from Test Call Launcher
  - Check CDR Viewer for the test call record
  - Verify balance threshold alert fires correctly
```

---

*Document generated by Bitsauto Monitoring Platform — Account Management module.*  
*For questions, contact the platform administrator.*
