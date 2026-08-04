-- Store the exact canonical DecisionResult alongside the flattened analytic
-- columns so the immutable decision store round-trips losslessly and its
-- content-hash integrity check (configChecksum(result) == content_hash) holds.
-- Additive; the flattened columns remain for indexing/analytics.

alter table public.decision_snapshots
  add column result jsonb not null default '{}'::jsonb;
