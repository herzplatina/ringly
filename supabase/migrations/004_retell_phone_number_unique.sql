-- One Retell phone number can belong to at most one business.
-- Guards the provisioning flow: when two businesses provision concurrently and
-- both pick the same orphaned/reused number, only the first UPDATE succeeds; the
-- second raises 23505 and is retried onto a different free number. NULLs are
-- excluded so un-provisioned businesses don't collide.
create unique index if not exists businesses_retell_phone_number_unique
  on businesses (retell_phone_number)
  where retell_phone_number is not null;
