-- Add retell_llm_id to businesses so prompt sync targets the LLM, not the agent
alter table businesses add column if not exists retell_llm_id text;

-- Prevent double-bookings at the DB level.
-- Two active appointments for the same business cannot start at the same time.
-- Cancelled/completed appointments are excluded so they don't block re-booking the slot.
create unique index if not exists appointments_business_starts_at_active_unique
  on appointments (business_id, starts_at)
  where status not in ('cancelled', 'completed', 'no_show');
