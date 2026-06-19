-- T001: Adapter metadata fields on portal_module_assignments
ALTER TABLE portal_module_assignments
  ADD COLUMN IF NOT EXISTS adapter_type      text,
  ADD COLUMN IF NOT EXISTS widget_profile    text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS access_scope      text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS realtime_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS density_mode      text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS default_time_range text NOT NULL DEFAULT '24h';
