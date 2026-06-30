export type BusinessType = "salon" | "clinic" | "tax_office" | "other";
export type WhatsappSenderStatus =
  "not_started" | "pending_verification" | "approved" | "rejected";
export const WHATSAPP_CONSENT_STATUSES = [
  "not_asked",
  "granted",
  "declined",
] as const;
export type WhatsappConsentStatus = (typeof WHATSAPP_CONSENT_STATUSES)[number];
export type AppointmentStatus =
  "booked" | "rescheduled" | "cancelled" | "completed" | "no_show";
export type ReminderStatus = "pending" | "sent" | "cancelled" | "failed";
export type ReminderKind = "confirmation" | "reminder_24h" | "reminder_4h";
export type CallOutcome =
  "booked" | "rescheduled" | "cancelled" | "inquiry_only" | "unresolved";

export type HoursRange = { open: string; close: string };

export type Business = {
  id: string;
  owner_user_id: string;
  name: string;
  business_type: BusinessType;
  address: string | null;
  timezone: string;
  retell_phone_number: string | null;
  retell_agent_id: string | null;
  whatsapp_number: string | null;
  whatsapp_sender_status: WhatsappSenderStatus;
  google_calendar_id: string | null;
  greeting_script: string | null;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
};

export type BusinessHours = {
  id: string;
  business_id: string;
  day_of_week: number;
  is_closed: boolean;
  hours_ranges: HoursRange[];
  updated_at: string;
};

export type Service = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  duration_minutes: number | null;
  source: "extracted" | "manual";
  active: boolean;
  created_at: string;
};

export type Customer = {
  id: string;
  business_id: string;
  phone_number: string;
  name: string | null;
  email: string | null;
  whatsapp_consent_status: WhatsappConsentStatus;
  whatsapp_consent_at: string | null;
  whatsapp_consent_call_id: string | null;
  created_at: string;
};

export type Appointment = {
  id: string;
  business_id: string;
  customer_id: string;
  service_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  google_calendar_event_id: string | null;
  source_call_id: string | null;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  service?: Service;
};

export type Reminder = {
  id: string;
  appointment_id: string;
  channel: "whatsapp";
  kind: ReminderKind;
  from_number: string;
  to_number: string;
  scheduled_for: string;
  status: ReminderStatus;
  sent_at: string | null;
  created_at: string;
};

export type Call = {
  id: string;
  business_id: string;
  retell_call_id: string;
  from_number: string | null;
  outcome: CallOutcome | null;
  is_test_call: boolean;
  created_at: string;
};

export type TimeSlot = {
  starts_at: string;
  ends_at: string;
};
