-- Harden the scientific-persistence trigger functions by pinning an empty
-- search_path (addresses the function_search_path_mutable advisory). These
-- functions only use trigger context + pg_catalog builtins (now()), so an empty
-- search_path is safe. Additive; does not alter table data.

alter function public.se_enforce_append_only() set search_path = '';
alter function public.se_enforce_breaker_resolve_only() set search_path = '';
alter function public.se_touch_updated_at() set search_path = '';
