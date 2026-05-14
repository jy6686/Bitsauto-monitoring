# Account Management Workflow & Operations Script
## Bitsauto Monitoring Platform — Internal Reference

**Document Version:** 2.0  
**Scope:** Company Creation · Company Editing · Client Account Wizard · IP Approval · Direct Provisioning · Sippy Integration  
**Updated:** May 2026  
**Classification:** Internal Operations — Do Not Distribute

---

## 1. Overview & Philosophy

The Account Management module follows a two-phase approach with two provisioning paths:

| Phase | What happens | System it touches |
|---|---|---|
| Phase A — Company | Create/edit the legal/commercial entity in BitsAuto | BitsAuto database only |
| Phase B — Provision | Create the live SIP account on Sippy | Sippy XML-RPC + BitsAuto |

### Two Provisioning Paths

| Path | When to use | Requirements |
|---|---|---|
| **Wizard Path** | Full setup with multiple trunks, codec rules, validation rules | Client wizard must be completed first |
| **Direct Path** | Quick provisioning from the Companies card | IPs approved on the card; wizard not required (but recommended) |

**Critical Rule — i_customer = 1 (Root), NEVER i_customer = 2 (RTST1)**

All new client accounts MUST be created under `i_customer = 1` (the ssp-root customer). Accounts created under `i_customer = 2` (RTST1) inherit RTST1's routing group, which causes:
- **"No Route Found"** errors on outbound calls
- **make2WayCallback failures** (wrong credential scope)
- Inability to assign independent billing plans

---

## 2. Phase A — Company Management

### 2.1 Creating a New Company

**Path:** Settings → Account Management → New Company (`/company/create`)

Three-step wizard. Company status starts as `draft` (`provisioningStatus = null`).

---

#### Step A1 — Basic Information

| Field | Required | Notes |
|---|---|---|
| Company Name | YES | Must be unique. Used as primary identifier across all reports. |
| Short Code | YES | 3–8 capital letters. Auto-uppercased on input. Must be unique. |
| Country | No | Used for timezone defaults and invoice headers. |
| KAM | YES | Key Account Manager. Select from active BitsAuto team members. |
| Status | YES | `active` or `inactive`. |
| Company Type | YES | `retail` — individual/SME client. `wholesale` — carrier/reseller. |
| Contract Type | YES | `bilateral` / `client` / `vendor`. |
| Department | YES | retail / wholesale / enterprise / carrier / reseller. |
| Team | No | Sub-team within the department. |
| Client Timezone | No | Timezone for client-facing reports and invoice dates. |
| Vendor Timezone | No | Timezone for vendor-facing CDR and billing. |
| Currency | YES | Default: USD. |

**Validation Rules:**
- Company Name and Short Code must be globally unique — system rejects duplicates with HTTP 409
- Short Code is automatically uppercased on input

---

#### Step A2 — Billing Information

**Vendor Billing (what we pay the carrier/vendor)**

| Field | Default | Notes |
|---|---|---|
| Vendor Billing Cycle | Weekly Cutoff | `weekly_cutoff` / `monthly` / `daily` / `bi_weekly` |
| Vendor Grace Period | 3 days | Days after cycle end before overdue status triggers |
| Vendor Credit Limit | 0 | Maximum outstanding amount before account suspension |
| Dispute Over % | 0 | Auto-flag disputes when variance exceeds this percentage |

**Client Billing (what the client pays us)**

| Field | Default | Notes |
|---|---|---|
| Client Billing Cycle | Weekly Cutoff | Same options as vendor |
| Client Grace Period | 3 days | Days before the client account triggers low-balance alert |
| Client Credit Limit | 0 | Credit extended to the client (postpaid only) |
| Dispute Over Value | 0 | Auto-flag client disputes above this absolute amount |
| Payment Term | prepaid | `prepaid` / `postpaid` / `credit` |

**Legal & Invoice**

| Field | Notes |
|---|---|
| Legal Name — Client Invoice | Full legal entity name as it appears on invoices sent to the client |
| Legal Name — Vendor Invoice | Full legal entity name as it appears on invoices received from the vendor |
| Invoice Email | Primary recipient for automated invoice emails |

---

#### Step A3 — Contacts & Bank

Four contact categories (technical / finance / commercial / billing), each supporting multiple entries.

**Required fields per contact:** First Name, Email  
**Optional:** Last Name, Phone, Fax

Bank accounts are optional at creation time. Multiple bank accounts can be added (e.g. USD + GBP accounts).

| Bank Field | Required |
|---|---|
| Bank Name | YES |
| Account Title | YES |
| Account Number | YES |
| SWIFT Code | YES |
| IBAN | No |
| Currency | YES (default USD) |
| Country | YES |
| Address, Remarks | No |

Click **"Create Company"** → record saved to BitsAuto DB. `provisioningStatus` is `null` (draft).

---

### 2.2 Editing an Existing Company

**Path:** Companies → click **Edit** on any company card  
**URL pattern:** `/company/edit/:id`

The edit page is the same 3-step form as creation but pre-populated with all existing data.

| Behaviour | Detail |
|---|---|
| All fields editable | Name, short code, billing, contacts, bank — all can be changed |
| Save button | Sends `PATCH /api/companies/:id` — updates in place |
| Provisioning status | NOT changed by editing. Edit is purely a data update. |
| Short code change | Allowed — but note Sippy tariff/plan names use the original short code |

**Important:** Editing a company does not affect its Sippy account if already provisioned. Changes to credentials or routing require a manual update in Sippy after editing.

---

## 3. Phase B — Provisioning to Sippy

A company must be provisioned to Sippy before it can originate or terminate calls. There are two paths.

### 3.1 Provisioning Status Flow

```
[Created] → provisioningStatus = null (draft)
     ↓  (wizard submitted OR IPs approved on card)
[Awaiting Provision] → provisioningStatus = pending_provision
     ↓  (admin clicks "Provision to Sippy")
[Provisioned] → provisioningStatus = provisioned
               sippyIAccount = <Sippy account ID>
               provisionedAt = <timestamp>
               provisionedBy = <admin username>
```

---

### 3.2 Path 1 — Direct Provisioning from Company Card

**No wizard required.** Add IPs directly on the company card, approve them, then provision.

**Step-by-step:**

1. Navigate to **Companies** page (`/company/list`)
2. Find the company card — every non-provisioned, non-suspended company shows an **IP Approval** panel
3. Click **"Add IP"** on the panel
   - Enter the IP address (IPv4 or CIDR)
   - Optionally enter the trunk name
   - Click **Submit** — IP status becomes `pending`
4. Approve the IP: click **Approve** next to the pending IP
   - You can also reject: click **Reject** → operator must resubmit
5. Once at least one IP is **approved** and zero are **pending**: the **"Provision to Sippy"** button turns green and becomes active
6. Click **"Provision to Sippy"** → confirm the dialog
   - System creates a Sippy Tariff (`SHORTCODE-TARIFF`)
   - System creates a Sippy Service Plan (`SHORTCODE-SP`) linked to the tariff
   - System calls `createAccount` on Sippy with `i_customer = 1`
   - Pushes all approved IP auth rules to Sippy
   - Updates company `provisioningStatus = provisioned`
   - Stores the Sippy `i_account` ID in the database

**Note:** If no wizard draft exists, the **"Provision to Sippy"** button remains disabled and shows a **"wizard required"** badge. Complete the Client Wizard (path 2 below) first to enable provisioning via this path.

**Note on incremental IP sync:** When a company is already provisioned and a new IP is approved on the card, the auth rule is pushed to Sippy immediately — no need to re-provision.

---

### 3.3 Path 2 — Wizard-Based Provisioning

**Path:** Account Management → New Client (`/client/wizard`)

**Pre-requisite:** The company must already exist in BitsAuto.

The wizard captures full Sippy account configuration across 7 steps, then submits via `POST /api/client-wizard/submit`. This saves a `wizardDraft` on the company record and transitions `provisioningStatus` to `pending_provision`.

---

#### Step B1 — Department & Company

| Field | Required | Notes |
|---|---|---|
| Department | YES | Filters the company dropdown |
| Company | YES | Select the BitsAuto company |
| Display Name | Auto | Pre-filled from company name. Used as account label in Sippy. |
| Sippy Username | YES | SIP username on Sippy. Auto-populated from company short code (lowercase). Must be globally unique. |
| Password | YES | SIP auth and web portal password. Auto-generated (12 chars). Re-generate with one click. |
| Notification Email (To) | No | Low balance alerts, system notifications |
| Notification Email (CC) | No | Secondary recipient |
| Balance Threshold Alert | No | Alert fires when prepaid balance drops below this value |

**Critical note on Sippy Username:**  
This becomes the `authname` in Sippy and appears in CDRs, billing reports, routing logs. Choose a meaningful, stable identifier — changing it after creation requires a full account update in Sippy.

---

#### Step B2 — Rate Sheet Configuration

| Field | Default | Notes |
|---|---|---|
| Invoice Template | Standard | Layout template for generated PDF invoices |
| Full Rate Sheet Format | Full CSV | Format sent for complete rate sheet distribution |
| Partial Rate Sheet Format | Partial Update | Format for partial/updated rates only |
| A2Z Rate Sheet Format | A2Z | Format for A-to-Z destination list |
| Dialcode Format | E.164 | `E.164` (+44...) / `National` (044...) / `Local` (44...) |
| Prefix Style | with_plus | Whether to include `+` prefix in rate sheet dial codes |

---

#### Step B3 — Technical Configuration (Per Trunk)

One or more trunks can be configured. Each trunk represents a logical traffic lane.

| Field | Required | Notes |
|---|---|---|
| Trunk / Switch Name | No | Descriptive label. Not sent to Sippy — BitsAuto display only. |
| **Default Routing Group** | **YES** | **Most critical field.** Blank = account inherits from parent customer (root) = "No Route Found". |
| Max Call Time (seconds) | No | Default: 3600 (1 hour). Hard cap on any single call duration. |
| Max Sessions | No | Default: 0 (unlimited). |
| Max CPS | No | Calls per second limit. |
| Preferred Codec | No | G.711u, G.711a, G.722, G.729, GSM, G.723, G.728. |
| Use Preferred Codec Only | No | Rejects calls that cannot use the preferred codec. |
| CLD Translation Rule | No | Regex substitution applied to called number. Default: `s/^//` (no-op). |
| Prevent Call Loops | No | Blocks calls routing back through the originating account. |
| Allow Registration | No | Default: on. Uncheck for IP-auth-only accounts. |

---

#### Step B4 — IPs & Trunk Assignment

| Field | Required | Notes |
|---|---|---|
| IP Address | YES | IPv4 or CIDR notation |
| Trunk | No | Which trunk this IP is associated with |
| Description | No | e.g. "Primary Media Server", "Backup SBC" |

Click **"Submit"** on each IP row → status becomes `pending`. Must be approved before Step B5 is available.

---

#### Step B5 — Authentication Rules (Gated — Approved IPs Only)

Locked until at least one IP is approved.

| Field | Options | Notes |
|---|---|---|
| Trunk | PREMIUM / STANDARD PLUS / STANDARD / BUSINESS / CHARLIE | Which trunk this rule applies to |
| IP Address | Dropdown — approved IPs only | Source IP Sippy will accept |
| Auth Type | IP Auth / SIP Digest / Both | Standard: `IP Auth` for IP-auth-only clients |
| Tech Prefix | Optional | Numeric prefix stripped from CLD before routing |
| Trust CLI | Checkbox | Trust CLI from this source without verification |

---

#### Step B6 — Validation Rules (Optional)

Restrict which numbers can be called. Actions: **Block**, **Allow Only** (whitelist), **Flag** (allow but tag in CDR).

---

#### Step B7 — Review & Submit

Summary of all configuration. Submit button is disabled if:
- Any IP is still `pending`
- User ID is blank
- Any trunk has no routing group selected

On submit, calls `POST /api/client-wizard/submit` which:
1. Stores the wizard draft on the company record (`wizardDraft` JSON field)
2. Sets `provisioningStatus = pending_provision`
3. Calls Sippy `createAccount()` XML-RPC with `i_customer = 1`
4. Sets routing group, max sessions, codec preferences
5. Returns the new Sippy `i_account` ID
6. Displays the Post-Creation Checklist

---

## 4. Post-Creation Checklist

After provisioning completes:

| Step | Automated | Action Required |
|---|---|---|
| Company record exists in BitsAuto | YES | Auto-created in Phase A |
| Client account created in Sippy (i_customer=1) | YES | Done by provisioning |
| Added to BitsAuto monitoring | YES | Auto-detected on next CDR/live-call cycle |
| Verify routing group has active vendor connections | NO | Routing Manager → Routing Groups — confirm group has vendors attached |
| Confirm rate sheet delivered to client email | NO | Check Email Centre → Sent Items |
| Run test call from new account | NO | Test Call Launcher → enter account's Sippy Username as originator |
| Check CDR after test call | NO | CDR Viewer → filter by account name — confirm call recorded with correct tariff |
| Confirm balance threshold alerts working | NO | Set threshold above current balance → verify alert fires |

---

## 5. IP Approval Flow — Detailed

### Submission Options

**Option A — From company card (no wizard needed):**
```
Companies page → find company card → click "Add IP"
→ Enter IP + optional trunk name → Submit
→ IP appears as pending on the card
```

**Option B — From Client Wizard Step B4:**
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

### Review

Pending IPs appear on the company card AND in the Approval Queue page (`/approvals`).

- **Approve** → `PATCH /api/client-ip-requests/:id/approve`
  - Sets status to `approved`, records reviewer and timestamp
  - If company is already provisioned: immediately pushes auth rule to Sippy (incremental sync)
  - If not yet provisioned: queued for push at provision time
- **Reject** → `PATCH /api/client-ip-requests/:id/reject`
  - Sets status to `rejected`, stores rejection reason
  - Operator must resubmit with a corrected IP

### Auth Rule Creation at Provision Time

```
Sippy XML-RPC: account.addAuthRule
Parameters:
  i_account: <newly created account ID>
  i_protocol: 1 (SIP)
  i_ip: <approved IP address>
  i_auth_type: 0 (IP Auth)
```

---

## 6. Sippy API Reference — Account Provisioning

### Naming Convention

When provisioning, BitsAuto auto-creates the following Sippy objects:

| Object | Name pattern | Example |
|---|---|---|
| Tariff | `{SHORTCODE}-TARIFF` | `ACME-TARIFF` |
| Service Plan | `{SHORTCODE}-SP` | `ACME-SP` |
| Account display name | Company name from BitsAuto | `Acme Corp Ltd` |
| Sippy username / authname | `step1.userId` from wizard (or short code) | `acme01` |

Duplicate guard: if the tariff or service plan already exists with that name, the existing one is reused (no error).

### Primary Method: createAccount()

**XML-RPC endpoint:** `POST https://<sippy-host>/xmlapi/xmlapi`  
**Auth:** HTTP Digest Authentication with admin credentials  
**Credentials scope:** ssp-root level (i_customer = 1)

**Key parameters:**

```xml
<methodCall>
  <methodName>createAccount</methodName>
  <params>
    <param><value><struct>
      <member><name>name</name><value><string>{displayName}</string></value></member>
      <member><name>authname</name><value><string>{sippyUsername}</string></value></member>
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

The provisioning endpoint uses admin XML-RPC credentials:

```
sippyXmlCreds(settings) → { username: SIPPY_PROV_USERNAME, password: SIPPY_PROV_PASSWORD }
```

These are stored as Replit environment secrets (`SIPPY_PROV_USERNAME`, `SIPPY_PROV_PASSWORD`) and never logged or exposed.

---

## 7. Common Errors & Fixes

### Error: "No Route Found" on test call after account creation

**Cause:** Routing group was not set on the account.

**Diagnosis:**
1. Open Sippy → Accounts → find the account
2. Check `Default Routing Group` field — if blank, this is the cause

**Fix:**
1. Edit the company via BitsAuto → set the routing group → re-provision, OR
2. Manually set routing group in Sippy portal

**Prevention:** The wizard enforces routing group selection. For direct provisioning, ensure the wizard draft includes a routing group.

---

### Error: "No wizard draft found. Complete the client wizard first."

**Cause:** Clicked "Provision to Sippy" from the company card but the Client Wizard has not been run for this company.

**Fix:** Go to Account Management → New Client → run the full 7-step wizard for this company. Then return to the Companies card and provision.

---

### Error: make2WayCallback fails for accounts created under RTST1

**Cause:** Accounts under `i_customer = 2` (RTST1) use RTST1's credentials for callbacks.

**Fix:** New accounts created via BitsAuto always use `i_customer = 1`. For legacy accounts under RTST1, move them to root using `account.updateAccount` with `i_customer: 1`.

---

### Error: HTTP 409 "Company name or short code already exists"

**Cause:** A company with the same name or short code already exists.

**Fix:** Check the Companies list for existing entries. Use a more specific name or different short code.

---

### Error: IP resubmission blocked ("IP already submitted and pending approval")

**Cause:** The same IP+clientName combination has a pending request.

**Fix:** Either wait for it to be approved/rejected, or reject it from the card/Approval Queue first, then resubmit.

---

### Error: "Provision to Sippy" button stays disabled after approving IPs

**Cause 1:** One or more IPs are still in `pending` state — must be zero pending.  
**Cause 2:** No wizard draft exists — the Client Wizard must be completed first.

**Fix:** Check the badge on the button: "N pending" means pending IPs remain. "wizard required" means the wizard hasn't been run. Address whichever applies.

---

### Error: Cause Code 401 on test call

**Cause:** Sippy-side configuration issue. Common causes:
- Zero balance (prepaid account with no top-up)
- Callback application not enabled on the account
- No routing (routing group has no vendor connections)

**Fix:** This is NOT a BitsAuto code issue. Check Sippy portal:
1. Verify account balance
2. Verify routing group has active vendor connections
3. Verify auth rules are in place (IP listed under account's Auth Rules in Sippy)

---

## 8. Database Schema Reference

### companies (key columns)

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | BitsAuto company ID |
| name | VARCHAR(256) UNIQUE | Display name |
| short_code | VARCHAR(32) UNIQUE | Prefix for user IDs and Sippy object names |
| provisioning_status | VARCHAR(32) | null (draft) / pending_provision / provisioned / suspended |
| wizard_draft | TEXT | JSON blob — wizard configuration stored on submit |
| sippy_i_account | INTEGER | Sippy account ID, set after successful provisioning |
| provisioned_at | TIMESTAMP | When provisioning completed |
| provisioned_by | VARCHAR(255) | Admin username who provisioned |
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
| GET | /api/companies | admin, management | List all companies (includes provisioningStatus, wizardDraft, sippyIAccount) |
| POST | /api/companies | admin, management | Create company (with contacts + bank accounts) |
| GET | /api/companies/:id | admin, management | Get single company |
| PATCH | /api/companies/:id | admin, management | Update company fields (partial update) |
| DELETE | /api/companies/:id | admin only | Delete company and all linked contacts/banks |
| GET | /api/client-ip-requests | admin, management | List all IP requests (filter by ?companyId=) |
| POST | /api/client-ip-requests | admin, management | Submit IP for approval |
| PATCH | /api/client-ip-requests/:id/approve | admin only | Approve an IP (incremental Sippy sync if already provisioned) |
| PATCH | /api/client-ip-requests/:id/reject | admin only | Reject an IP |
| POST | /api/client-wizard/submit | admin, management | Run full 7-step wizard — saves wizardDraft, sets pending_provision |
| POST | /api/companies/:id/provision | admin only | Provision company to Sippy (creates tariff, service plan, account, auth rules) |

---

## 10. Quick Reference — Full Workflow

```
OPTION A — Quick Provisioning (no wizard)
─────────────────────────────────────────
  1. Phase A: Create company (3-step form) — fills BitsAuto DB only
  2. On Companies page: click "Add IP" on the company card
  3. Enter IP address (+ optional trunk) → Submit → IP becomes pending
  4. Click "Approve" on the pending IP
  5. Click "Provision to Sippy" (green button appears once ≥1 IP approved)
  6. Confirm dialog → BitsAuto creates tariff, service plan, Sippy account, auth rules
  NOTE: Step 5 requires the Client Wizard to have been completed first
        (wizard stores the account config used during provisioning)

OPTION B — Full Wizard Provisioning
─────────────────────────────────────
  Phase A — Company (10–15 min)
    1. Account Management → New Company
    2. Step A1: Fill name, short code, country, KAM, type, department, currency
    3. Step A2: Set billing cycles, grace periods, credit limits, payment terms, legal names
    4. Step A3: Add contacts and bank account if available
    5. Click "Create Company" → saved to BitsAuto DB

  Phase B — Client Wizard (15–30 min)
    1. Account Management → New Client
    2. Step B1: Select company, confirm Sippy Username and password, set notification email
    3. Step B2: Confirm rate sheet format and invoice template
    4. Step B3: Add trunk(s). MANDATORY: select routing group for every trunk
    5. Step B4: Add client IPs. Click "Submit" on each to queue for approval
    6. Go to Approval Queue (/approvals) and approve IPs (or admin approves on company card)
    7. Step B5: Return after IPs approved. Create auth rules using approved IPs
    8. Step B6: Add validation rules if needed
    9. Step B7: Review all settings. Click "Create Client in Sippy"
       → Wizard saves draft, transitions company to pending_provision
       → Admin clicks "Provision to Sippy" on company card to complete

  Post-Provisioning (within 30 min)
    - Verify routing group vendor connections (Routing Manager → select the routing group)
    - Send rate sheet from Email Centre
    - Run test call from Test Call Launcher
    - Check CDR Viewer for the test call record
    - Verify balance threshold alert fires correctly

EDITING A COMPANY (any time)
  - Companies page → click "Edit" on any card
  - All 3 steps are pre-populated with existing data
  - Change any fields → click "Save Changes" → sends PATCH to server
  - Edit does NOT change provisioning status or Sippy account
```

---

*Document Version 2.0 — Updated May 2026*  
*Bitsauto Monitoring Platform — Account Management module.*  
*For questions, contact the platform administrator.*
