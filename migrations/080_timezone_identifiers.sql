-- 080_timezone_identifiers.sql
--
-- Store timezone IDENTIFIERS, not dropdown labels.
--
-- The company wizards stored their display labels as the value —
-- "GMT+00:00 | UTC", "GMT+05:00 | Karachi". Those are not IANA identifiers, so
-- when one reached Intl.DateTimeFormat on the Invoices page it threw RangeError,
-- escaped to the React error boundary, and took the whole page down.
--
-- The application now resolves these at read time and can no longer crash on
-- them, so this is cleanup rather than the fix: it stops the bad values
-- propagating into new records and reports, and makes the stored data mean what
-- its column name says.
--
-- Anything unrecognised is deliberately LEFT ALONE rather than forced to UTC:
-- silently moving a customer's clock is worse than an odd string the resolver
-- already handles safely.

BEGIN;

CREATE TEMP TABLE _tz_map (label VARCHAR(64), iana VARCHAR(64)) ON COMMIT DROP;
INSERT INTO _tz_map (label, iana) VALUES
  ('GMT+00:00 | UTC',         'UTC'),
  ('GMT+01:00 | London',      'Europe/London'),
  ('GMT+02:00 | Cairo',       'Africa/Cairo'),
  ('GMT+03:00 | Riyadh',      'Asia/Riyadh'),
  ('GMT+04:00 | Dubai',       'Asia/Dubai'),
  ('GMT+05:00 | Karachi',     'Asia/Karachi'),
  ('GMT+05:30 | Mumbai',      'Asia/Kolkata'),
  ('GMT+06:00 | Dhaka',       'Asia/Dhaka'),
  ('GMT+07:00 | Bangkok',     'Asia/Bangkok'),
  ('GMT+08:00 | Singapore',   'Asia/Singapore'),
  ('GMT+09:00 | Tokyo',       'Asia/Tokyo'),
  ('GMT-05:00 | New York',    'America/New_York'),
  ('GMT-08:00 | Los Angeles', 'America/Los_Angeles');

DO $$
DECLARE n integer; total integer := 0;
BEGIN
  UPDATE companies c SET client_timezone = m.iana
    FROM _tz_map m WHERE c.client_timezone = m.label;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  UPDATE companies c SET vendor_timezone = m.iana
    FROM _tz_map m WHERE c.vendor_timezone = m.label;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  RAISE NOTICE '080: % timezone value(s) converted from display label to IANA identifier.', total;
END $$;

COMMIT;
