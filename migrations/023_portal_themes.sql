-- T002: Portal theme engine fields on portal_definitions
ALTER TABLE portal_definitions
  ADD COLUMN IF NOT EXISTS primary_color      text NOT NULL DEFAULT 'purple',
  ADD COLUMN IF NOT EXISTS accent_color       text NOT NULL DEFAULT 'indigo',
  ADD COLUMN IF NOT EXISTS background_style   text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS density            text NOT NULL DEFAULT 'comfortable',
  ADD COLUMN IF NOT EXISTS nav_style          text NOT NULL DEFAULT 'glass',
  ADD COLUMN IF NOT EXISTS font_scale         text NOT NULL DEFAULT 'normal';

-- Seed theme defaults per portal
UPDATE portal_definitions SET primary_color='purple',  accent_color='violet',  background_style='flat',     density='comfortable', nav_style='glass', font_scale='normal' WHERE slug='kam';
UPDATE portal_definitions SET primary_color='blue',    accent_color='cyan',    background_style='gradient', density='compact',     nav_style='solid', font_scale='normal' WHERE slug='noc';
UPDATE portal_definitions SET primary_color='emerald', accent_color='green',   background_style='flat',     density='comfortable', nav_style='glass', font_scale='normal' WHERE slug='finance';
UPDATE portal_definitions SET primary_color='indigo',  accent_color='blue',    background_style='flat',     density='comfortable', nav_style='glass', font_scale='normal' WHERE slug='partner';
UPDATE portal_definitions SET primary_color='slate',   accent_color='gray',    background_style='flat',     density='comfortable', nav_style='solid', font_scale='normal' WHERE slug='admin';
