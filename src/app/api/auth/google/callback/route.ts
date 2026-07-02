import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";
import { env } from "@/lib/env";

// Google is Ringly's identity provider. Supabase runs the OAuth (PKCE); this
// callback exchanges the code for a session and captures the offline
// provider_refresh_token so we can call Google Calendar server-side later.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  // Redirect off the configured public URL, not req.nextUrl.origin — behind a
  // proxy/tunnel (ngrok) the request origin can resolve to https://localhost.
  const origin = env.NEXT_PUBLIC_APP_URL;
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL("/login?error=exchange", origin));
  }

  // provider_refresh_token is only present on first consent (prompt=consent).
  // Stash it (encrypted) in the user's server-only app_metadata; claim will move
  // it onto the business row for calendar sync.
  const refreshToken = data.session.provider_refresh_token;
  if (refreshToken) {
    try {
      const admin = createServiceClient();
      await admin.auth.admin.updateUserById(data.session.user.id, {
        app_metadata: { google_refresh_token_enc: encrypt(refreshToken) },
      });
    } catch (e) {
      console.error("callback: failed to persist refresh token", e);
    }
  }

  // Returning owner (already has a business) → dashboard; new owner → finish.
  const admin = createServiceClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id")
    .eq("owner_user_id", data.session.user.id)
    .maybeSingle();

  return NextResponse.redirect(
    new URL(biz ? "/dashboard" : "/onboarding/finish", origin),
  );
}
