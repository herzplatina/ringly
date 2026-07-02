# Ringly — PRD + EDD (v2.0)

_Supersedes `Ringly_PRD_EDD.docx` (v1.0, 2026-06-29). Revised 2026-07-01 for the
conversational, auto-enriched onboarding redesign and Google-as-identity auth._

---

# Part 1 — Product Requirements (PRD)

## 1.1 Vision

Ringly gives a small business a dedicated AI receptionist that answers calls,
books/reschedules/cancels appointments, and syncs to Google Calendar. **v2
reimagines onboarding**: instead of a 7-step form behind a login wall, a new
owner lands on a single conversational screen, describes their business in one
sentence (typed or spoken), and watches Ringly auto-discover and fill in
everything about them. Sign-in is their Google account. Target: from landing to
a live receptionist in **under 3 minutes, with near-zero typing**.

## 1.2 What changed from v1

| Area           | v1                                                 | v2                                                                   |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Entry          | Email/password signup → 7-step wizard              | Public conversational intake screen                                  |
| Data entry     | Manual forms for name, type, hours, timezone, menu | Auto-enriched from Google Places; user only edits                    |
| Input modality | Typing                                             | Typing **or voice** (speak the business name/address)                |
| Identity       | Supabase email/password                            | **Google OAuth = Ringly identity** (one consent)                     |
| Calendar       | Separate OAuth step                                | Same Google consent grants `calendar.events`                         |
| Menu           | Manual upload only                                 | Auto-extract from business website (Claude); upload as fallback      |
| WhatsApp       | Onboarding step                                    | **Removed from onboarding** (backend consent/confirm logic retained) |
| Provisioning   | Explicit "Go Live" step                            | Background auto-provision while showing product benefits             |

## 1.3 Primary persona

Non-technical owner of a salon, clinic, or tax office. Has a Google account and
a public business listing on Google Maps. Wants a receptionist, not a
configuration project.

## 1.4 The onboarding flow (happy path)

1. **Land on the intake screen** (public, no login). One large textarea with
   shadow placeholder _"Tell me the name and address of your business…"_. The
   page also **speaks** that prompt (voice output) and offers a **mic button**
   for voice input. User types or says e.g. _"Glamour Studio, 123 Main St,
   Austin."_
2. **Live enrichment.** As they finish, the backend resolves the business via
   Google Places and **incrementally autofills** a card: _"Welcome, Glamour
   Studio!"_ then address → phone → opening hours → timezone → menu items (with
   descriptions + prices). Fields animate in as they resolve.
3. **Inline edit.** Every filled field is editable in place; the user corrects
   anything wrong and can add/remove services. If no website/menu is found, they
   can **upload a menu image/PDF** (Claude vision) or add services manually.
4. **"Set up your AI Receptionist"** → triggers **Continue with Google** (single
   consent = sign-in + calendar). On return, Ringly:
   - creates the account + business (owned by that Google identity),
   - **buys the Retell number in the background**,
   - stores the encrypted Google refresh token for calendar sync.
5. **Value screen while provisioning.** Show product benefits during the
   ~seconds of Retell setup. On completion: **"You're signed in to Ringly as
   name@business.com — this Google account is your login and your calendar."**
6. **Success + Go Live.** Show the new number and a **Go Live** button → a
   _"Call me at (xxx) yyy-zzzz — watch it work"_ screen.

## 1.5 Functional requirements

- **FR1** Intake accepts free-form text; no structured fields required.
- **FR2** Voice input (speech→text) and voice output (text→speech) via the
  browser; graceful fallback to typing if unsupported/denied.
- **FR3** Enrichment resolves: legal/display name, formatted address, public
  phone, regular opening hours, IANA timezone, website — from Google Places.
- **FR4** Menu/services (name, description, price) auto-extracted from the
  resolved website via Claude; fallback to image/PDF upload or manual entry.
- **FR5** All enriched fields are inline-editable before commit.
- **FR6** Enrichment streams incrementally (user sees fields appear, not a
  spinner-then-dump).
- **FR7** Single Google OAuth grants Ringly session **and** offline
  `calendar.events` access; the account is keyed to the Google identity.
- **FR8** After confirm + auth, the user is told their Google login is now their
  Ringly login.
- **FR9** Retell number purchase + agent provisioning run in the background,
  surfaced as progress, not a blocking form step.
- **FR10** No WhatsApp UI anywhere in onboarding.

## 1.6 Out of scope (this iteration)

- WhatsApp reminders/dispatcher (backend consent + inline confirmation retained,
  but not surfaced or scheduled).
- Bring-your-own-number / SIP import (still buy-a-Retell-number).
- Multi-location businesses; non-US numbers.

## 1.7 Success metrics

- Time-to-live (land → Go Live) p50 < 3 min.
- % of businesses resolved by Places on first try (target > 80%).
- Manual field edits per onboarding (lower is better).
- Onboarding completion rate vs v1.

---

# Part 2 — Engineering Design (EDD)

## 2.1 Architecture summary

Unchanged core stack (Next.js 15 App Router on Vercel, Supabase Postgres/Auth,
Retell voice, Google Calendar, Claude for extraction). New in v2:

- **Google Places API (New)** — business discovery + details.
- **Supabase Auth Google provider** — replaces email/password as the identity.
- **Streaming enrichment endpoint** — Server-Sent Events for incremental fill.
- **Website menu extraction** — fetch `websiteUri` → Claude text extraction.

## 2.2 Verified vendor capabilities (confirmed 2026-07-01)

- **Places API (New) Place Details** returns in one call: `displayName`,
  `formattedAddress`, `nationalPhoneNumber`/`internationalPhoneNumber`,
  `regularOpeningHours`, `location{latitude,longitude}`, `websiteUri`, and
  **`timeZone` (IANA)** + `utcOffsetMinutes`. No separate Time Zone API needed.
  Menus are **not** available (only `priceLevel`/`priceRange`). Several fields
  bill at **Text Search Pro/Enterprise** SKUs — budget per-lookup cost.
  Sources: [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details),
  [Place Data Fields (New)](https://developers.google.com/maps/documentation/places/web-service/data-fields),
  [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search).
- **Supabase Google OAuth** yields `provider_refresh_token` for offline
  server-side Calendar access when `signInWithOAuth('google')` is called with
  `access_type:'offline'`, `prompt:'consent'`, and scope
  `https://www.googleapis.com/auth/calendar.events`. Use the PKCE server-side
  flow with a callback route to exchange the code and capture the tokens.
  Sources: [Login with Google | Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google),
  [signInWithOAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth),
  [storing provider_refresh_token](https://github.com/orgs/supabase/discussions/22653).

## 2.3 New / changed components

### Frontend

- **`/` (public intake)** — textarea + shadow prompt; Web Speech API
  `SpeechRecognition` (input) and `SpeechSynthesis` (output); mic + speaker
  toggles; feature-detect and fall back to typing. Holds enrichment result in
  client state + `sessionStorage` (survives the OAuth round-trip).
- **Enrichment card** — subscribes to the SSE stream; renders each field as it
  arrives; every field is an inline-editable control; menu list supports
  add/remove/edit and an upload fallback.
- **Provisioning/benefits screen** — polls provision status; shows benefits;
  then the identity confirmation + success + Go Live.
- **Removed:** email/password `signup`/`login` pages (replaced by "Continue with
  Google"); the WhatsApp onboarding step and `business/whatsapp` UI.

### Backend (API routes)

- **`POST /api/enrich` (SSE)** — body: `{ text }`. Steps, each emitted as an
  event: (1) Places **Text Search** to resolve the place → `emit welcome`;
  (2) Place **Details** (fields above) → `emit address/phone/hours/timezone`;
  (3) if `websiteUri`, fetch page → Claude extraction → `emit menu` items as
  parsed. Maps Places `regularOpeningHours` → `business_hours` schema; maps
  `timeZone` → `businesses.timezone`.
- **`POST /api/business/claim`** — after Google auth: creates the `businesses`
  row owned by the new user from the client-held enriched draft (idempotent).
- **`GET /api/auth/google/callback`** — reworked: Supabase PKCE code exchange;
  store session; capture + encrypt `provider_refresh_token` into `google_tokens`
  for server-side calendar use (reuses existing `encrypt.ts`).
- **`POST /api/retell/provision`** — unchanged logic, now invoked
  programmatically post-claim (background), not a UI step.
- **Retained:** `menu-extract` (now also accepts a URL/text, not just image),
  the three Retell webhooks, calendar helpers.

## 2.4 Data model changes (migration 003)

Add to `businesses`: `google_place_id text`, `formatted_address text`,
`public_phone text` (the listing's own number — informational, distinct from
`retell_phone_number`), `website_url text`, `latitude/longitude`,
`onboarding_status text` (`draft|provisioning|live`) to replace the numeric
`onboarding_step` stepper. Keep WhatsApp columns (unused by onboarding).

## 2.5 Auth model

- Google is the **sole** identity provider. `signInWithOAuth('google', { scopes:
'calendar.events', queryParams: { access_type:'offline', prompt:'consent' },
redirectTo: <callback> })`.
- Callback exchanges the code (PKCE, server-side), establishes the Supabase
  session, and persists the encrypted `provider_refresh_token`. Server-side
  calendar calls use that refresh token (replacing today's standalone calendar
  OAuth).
- RLS unchanged (`owner_user_id = auth.uid()`).
- **Draft-before-auth**: the pre-auth enriched business lives in client state;
  `/api/business/claim` binds it to the user post-auth. No anonymous DB rows.

## 2.6 Sequence (happy path)

```
User → /                : type/speak "Glamour Studio, Austin"
Browser → /api/enrich   : SSE
  Places TextSearch     → welcome(name)
  Places Details        → address, phone, hours, timezone
  fetch(websiteUri)+Claude → menu[]         (edits allowed throughout)
User clicks "Set up…"   : signInWithOAuth(google, calendar.events, offline)
Google → /callback      : PKCE exchange → session + encrypted refresh token
Browser → /claim        : create business (owner=user) from draft
Browser → /provision    : buy number, create LLM+agent, bind  (background)
   (benefits screen)     → identity confirmation → success(number) → Go Live
```

## 2.7 Risks & mitigations

- **Places can't resolve the business** → show top candidates to disambiguate;
  allow full manual entry.
- **No website / unparseable menu** → upload (Claude vision) or manual services.
- **Web Speech API support/permissions** (Safari/Firefox partial) → feature
  detect; typing always available; voice is enhancement, never required.
- **Places SKU cost** → cache by `place_id`; request only needed field masks;
  debounce enrichment to fire once on submit, not per keystroke.
- **Refresh-token capture** — Google only returns it with `prompt=consent`;
  always force consent on first link; handle re-consent if missing.
- **Draft loss across OAuth redirect** → persist draft in `sessionStorage` +
  a short-lived server draft keyed by a nonce as backup.

## 2.8 Prerequisites / config

- **New env `GOOGLE_MAPS_API_KEY`** (server-side); enable **Places API (New)** in
  Google Cloud; restrict the key to that API.
- **Supabase**: enable Google provider; set the OAuth client + authorized
  redirect to `${APP_URL}/api/auth/google/callback`; add the `calendar.events`
  scope. Reuse existing `GOOGLE_CLIENT_ID/SECRET`.
- `GOOGLE_REDIRECT_URI` continues to point at the callback (already fixed).

## 2.9 Rollout

Ship behind a route swap: new `/` intake for logged-out users; existing
dashboard untouched. Keep the old wizard reachable at `/onboarding/legacy`
until the new flow is validated end-to-end, then delete.
