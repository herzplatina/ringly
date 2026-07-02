"use client";
export const dynamic = "force-dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Google is Ringly's sole identity provider (email/password removed).
export default function LoginPage() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.events",
        redirectTo: `${window.location.origin}/api/auth/google/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold text-indigo-600">Ringly</h1>
          <p className="mt-2 text-gray-600">Sign in to your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-8 space-y-4">
          <Button onClick={signIn} className="w-full">
            Continue with Google
          </Button>
          <p className="text-xs text-gray-500">
            Your Google account is your Ringly login and your booking calendar.
          </p>
        </div>
        <a href="/" className="text-sm text-indigo-600 underline">
          New here? Set up your receptionist →
        </a>
      </div>
    </div>
  );
}
