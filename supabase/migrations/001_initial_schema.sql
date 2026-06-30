-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── businesses ──────────────────────────────────────────────────────────────
create table businesses (
  id                    uuid primary key default uuid_generate_v4(),
  owner_user_id         uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  business_type         text not null check (business_type in ('salon','clinic','tax_office','other')),
  address               text,
  timezone              text not null default 'America/New_York',
  retell_phone_number   text,
  retell_agent_id       text,
  whatsapp_number       text,
  whatsapp_sender_status text not null default 'not_started'
                          check (whatsapp_sender_status in ('not_started','pending_verification','approved','rejected')),
  google_calendar_id    text,
  google_refresh_token  text,
  greeting_script       text,
  onboarding_step       int not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table businesses enable row level security;
create policy "owner access" on businesses
  for all using (owner_user_id = auth.uid());

-- ── business_hours ──────────────────────────────────────────────────────────
create table business_hours (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid not null references businesses(id) on delete cascade,
  day_of_week   int not null check (day_of_week between 0 and 6),
  is_closed     boolean not null default false,
  hours_ranges  jsonb not null default '[]',
  updated_at    timestamptz not null default now(),
  unique (business_id, day_of_week)
);

alter table business_hours enable row level security;
create policy "owner access" on business_hours
  for all using (
    business_id in (select id from businesses where owner_user_id = auth.uid())
  );

-- ── services ────────────────────────────────────────────────────────────────
create table services (
  id                uuid primary key default uuid_generate_v4(),
  business_id       uuid not null references businesses(id) on delete cascade,
  name              text not null,
  description       text,
  price_cents       int,
  duration_minutes  int,
  source            text not null default 'manual' check (source in ('extracted','manual')),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

alter table services enable row level security;
create policy "owner access" on services
  for all using (
    business_id in (select id from businesses where owner_user_id = auth.uid())
  );

-- ── customers ───────────────────────────────────────────────────────────────
create table customers (
  id                          uuid primary key default uuid_generate_v4(),
  business_id                 uuid not null references businesses(id) on delete cascade,
  phone_number                text not null,
  name                        text,
  email                       text,
  whatsapp_consent_status     text not null default 'not_asked'
                                check (whatsapp_consent_status in ('not_asked','granted','declined')),
  whatsapp_consent_at         timestamptz,
  whatsapp_consent_call_id    text,
  created_at                  timestamptz not null default now(),
  unique (business_id, phone_number)
);

alter table customers enable row level security;
create policy "owner access" on customers
  for all using (
    business_id in (select id from businesses where owner_user_id = auth.uid())
  );

-- ── appointments ────────────────────────────────────────────────────────────
create table appointments (
  id                      uuid primary key default uuid_generate_v4(),
  business_id             uuid not null references businesses(id) on delete cascade,
  customer_id             uuid not null references customers(id),
  service_id              uuid references services(id),
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  status                  text not null default 'booked'
                            check (status in ('booked','rescheduled','cancelled','completed','no_show')),
  google_calendar_event_id text,
  source_call_id          text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table appointments enable row level security;
create policy "owner access" on appointments
  for all using (
    business_id in (select id from businesses where owner_user_id = auth.uid())
  );

-- ── reminders ───────────────────────────────────────────────────────────────
create table reminders (
  id              uuid primary key default uuid_generate_v4(),
  appointment_id  uuid not null references appointments(id) on delete cascade,
  channel         text not null default 'whatsapp' check (channel in ('whatsapp')),
  kind            text not null check (kind in ('confirmation','reminder_24h','reminder_4h')),
  from_number     text not null,
  to_number       text not null,
  scheduled_for   timestamptz not null,
  status          text not null default 'pending'
                    check (status in ('pending','sent','cancelled','failed')),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

alter table reminders enable row level security;
create policy "owner access" on reminders
  for all using (
    appointment_id in (
      select id from appointments where
        business_id in (select id from businesses where owner_user_id = auth.uid())
    )
  );

-- ── calls ───────────────────────────────────────────────────────────────────
-- Transcripts and recordings are NOT stored here.
-- They are fetched from the Retell API on demand using retell_call_id.
create table calls (
  id              uuid primary key default uuid_generate_v4(),
  business_id     uuid not null references businesses(id) on delete cascade,
  retell_call_id  text not null unique,
  from_number     text,
  outcome         text check (outcome in ('booked','rescheduled','cancelled','inquiry_only','unresolved')),
  is_test_call    boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table calls enable row level security;
create policy "owner access" on calls
  for all using (
    business_id in (select id from businesses where owner_user_id = auth.uid())
  );

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_updated_at before update on businesses
  for each row execute function set_updated_at();
create trigger appointments_updated_at before update on appointments
  for each row execute function set_updated_at();
create trigger business_hours_updated_at before update on business_hours
  for each row execute function set_updated_at();

-- ── consent cascade trigger ─────────────────────────────────────────────────
-- When a customer's consent is changed to 'declined', cancel their pending reminders
create or replace function cancel_reminders_on_consent_decline()
returns trigger language plpgsql as $$
begin
  if new.whatsapp_consent_status = 'declined' and old.whatsapp_consent_status != 'declined' then
    update reminders
    set status = 'cancelled'
    where status = 'pending'
      and appointment_id in (
        select id from appointments
        where customer_id = new.id
          and starts_at > now()
          and status not in ('cancelled')
      );
  end if;
  return new;
end;
$$;

create trigger customer_consent_decline before update on customers
  for each row execute function cancel_reminders_on_consent_decline();
