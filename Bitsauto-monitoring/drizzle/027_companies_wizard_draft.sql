-- Migration 027: Wizard draft persistence on companies
-- Stores incomplete onboarding wizard state so it survives page refreshes.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS wizard_draft TEXT;
