import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import { encrypt } from "@/lib/encrypt";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const returnedState = req.nextUrl.searchParams.get("state") ?? "";

  if (!code) {
    return NextResponse.redirect(
      new URL("/onboarding?step=5&error=no_code", req.url),
    );
  }

  // Verify session BEFORE consuming the one-time authorization code
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Verify CSRF state cookie
  const storedState = req.cookies.get("google_oauth_state")?.value ?? "";
  if (!storedState || storedState !== returnedState) {
    const errResp = NextResponse.redirect(
      new URL("/onboarding?step=5&error=csrf_mismatch", req.url),
    );
    errResp.cookies.delete("google_oauth_state");
    return errResp;
  }

  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) {
    return NextResponse.redirect(
      new URL("/onboarding?step=5&error=no_refresh_token", req.url),
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (!business) {
    return NextResponse.redirect(
      new URL("/onboarding?step=5&error=no_business", req.url),
    );
  }

  // Discover primary calendar ID
  const oauth2 = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  oauth2.setCredentials(tokens);
  const cal = google.calendar({ version: "v3", auth: oauth2 });
  const { data: calList } = await cal.calendarList.list();
  const primary = calList.items?.find((c) => c.primary)?.id ?? "primary";

  await supabase
    .from("businesses")
    .update({
      google_refresh_token: encrypt(tokens.refresh_token),
      google_calendar_id: primary,
      onboarding_step: 6,
    })
    .eq("id", business.id);

  const response = NextResponse.redirect(
    new URL("/onboarding?step=6", req.url),
  );
  // Clear the CSRF state cookie
  response.cookies.delete("google_oauth_state");
  return response;
}
