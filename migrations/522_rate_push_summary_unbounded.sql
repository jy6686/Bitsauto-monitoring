-- 522: the rate-push audit summaries stop having a maximum number of destinations.
--
-- OBSERVED 2026-09-18. A Send Rate for the client "aura" — four Business Class destinations
-- that expand to five prefixes — was refused with:
--
--   Could not record this push (value too long for type character varying(32)).
--   Refusing to run it unrecorded.
--
-- The guard was right and the schema was wrong. `rate_push_jobs` is written BEFORE the first
-- mutation-capable request precisely so that no push can run unrecorded, so a column too
-- narrow to hold the record does not merely lose audit detail: it blocks the operation. Five
-- prefixes joined ("29230, 29232, 29233, 29231, 29234") is 33 characters against a 32-character
-- column. Four would have fitted, which is why this survived until a batch crossed five.
--
-- THE FIELDS ARE JOINED SUMMARIES AND HAVE NO BUSINESS MAXIMUM. Each holds one entry per
-- destination in the batch, so any fixed width is a cap on how many destinations may be pushed
-- at once — 32, 128 and 256 are simply different places for the same wall. The operator's
-- requirement is explicit: a team pushing five, fifty or two hundred destinations must not be
-- stopped by the recording layer.
--
-- The other two columns did not error; they truncated. `dial_prefix` at 128 loses prefixes past
-- roughly a dozen and `destination_name` at 256 loses names past roughly nine, silently, in the
-- record that exists to say what was pushed. A truncated audit row is worse than a rejected one
-- because nothing reports it.
--
-- `client_names` in the same table is already TEXT and already written without truncation. This
-- brings its three siblings to the pattern that column has always had, rather than inventing one.
--
-- Non-destructive: widening varchar to text preserves every existing value, needs no rewrite of
-- the rows, and no application code reads these fields by length.
BEGIN;

ALTER TABLE rate_push_jobs ALTER COLUMN full_prefix      TYPE TEXT;
ALTER TABLE rate_push_jobs ALTER COLUMN dial_prefix      TYPE TEXT;
ALTER TABLE rate_push_jobs ALTER COLUMN destination_name TYPE TEXT;

-- Per-operation rows carry ONE prefix each, so `rate_push_operations.full_prefix` is a single
-- value with a real bound and is deliberately left as varchar(32). Only the batch-level
-- summaries are unbounded.

COMMIT;
