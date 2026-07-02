-- v2 conversational onboarding: Places-enriched fields + status field.
-- `address` already exists on businesses (from 001).

alter table businesses add column if not exists google_place_id text;
alter table businesses add column if not exists formatted_address text;
alter table businesses add column if not exists public_phone text; -- the listing's own number (informational; not the Retell number)
alter table businesses add column if not exists website_url text;
alter table businesses add column if not exists latitude double precision;
alter table businesses add column if not exists longitude double precision;

-- Replace the numeric onboarding_step stepper with a coarse status for the v2 flow.
-- Kept alongside onboarding_step so the legacy wizard still works.
alter table businesses add column if not exists onboarding_status text
  not null default 'draft'
  check (onboarding_status in ('draft', 'provisioning', 'live'));
