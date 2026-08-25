-- 077_billing_contacts_branding_terms_backfill.sql
--
-- Three owner directives from the CAP-003 review:
--
-- 1. Billing contact separation. Outgoing invoice mail gains CC/BCC copies to
--    the issuer's own finance mailboxes and a Reply-To pointing at the dispute
--    mailbox — how wholesale operators separate invoice delivery from dispute
--    handling. Plus accounts contact and phone for the document identity.
--
-- 2. Branding as data. Logo and signature stored as data-URIs on settings —
--    the deployment is a VM whose filesystem resets on republish, so a file
--    written at runtime would silently vanish; a database column survives.
--    The renderer already proves the pattern (email logo is a base64 URI).
--
-- 3. Payment-terms deprecation, step 1 of the owner's plan: migrate partner
--    Net-days into companies.payment_term so the company profile alone states
--    the commercial agreement. The resolver's partner fallback stays for now
--    (step 2 removes it once data is verified); prepaid companies and
--    companies whose own term already states a length are never touched.
--    business_partners.payment_terms_days itself REMAINS — vendor bills (AP)
--    legitimately use it for the payable direction.

BEGIN;

-- ── Issuer billing contacts ───────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_cc       TEXT;          -- comma-separated
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_bcc      TEXT;          -- comma-separated
ALTER TABLE settings ADD COLUMN IF NOT EXISTS accounts_email   VARCHAR(255);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS billing_phone    VARCHAR(64);

-- ── Branding ──────────────────────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_logo       TEXT;        -- data:image/...;base64,
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_signature  TEXT;        -- data:image/...;base64,
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_signatory  VARCHAR(128);-- printed under the signature

-- ── Terms backfill: partner Net-days → company profile ───────────────────────
-- Only where the company's own term carries no length (NULL/''/postpaid/credit
-- — for these the resolver already fell back to the partner days, so the
-- invoice output is IDENTICAL before and after; the source just becomes
-- explicit). 'prepaid' is a deliberate commercial choice and is never touched.
-- One partner row per company name (newest wins) to make the join deterministic.
DO $$
DECLARE n integer;
BEGIN
  UPDATE companies c
     SET payment_term = 'net_' || bp.payment_terms_days
    FROM (
      SELECT DISTINCT ON (lower(name)) lower(name) AS lname, payment_terms_days
        FROM business_partners
       WHERE deleted_at IS NULL
         AND payment_terms_days IS NOT NULL
         AND payment_terms_days > 0
       ORDER BY lower(name), created_at DESC
    ) bp
   WHERE bp.lname = lower(c.name)
     AND (c.payment_term IS NULL OR c.payment_term IN ('', 'postpaid', 'credit'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '077: % company payment term(s) backfilled from partner Net-days (identical resolver output, source now explicit).', n;
END $$;

DO $$
BEGIN
  RAISE NOTICE '077: billing CC/BCC/accounts/phone + logo/signature branding columns ensured; terms backfill done.';
END $$;

COMMIT;
