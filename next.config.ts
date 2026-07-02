import type { NextConfig } from "next";

// In dev, allow the configured public host (e.g. an ngrok tunnel) to load
// Next.js dev resources (HMR + client bundles); otherwise cross-origin requests
// are blocked and the page never hydrates. Derived from env, never hardcoded,
// and only applied outside production (allowedDevOrigins is dev-only anyway).
function devOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return [];
  try {
    const { protocol, host } = new URL(url);
    // Only well-formed http(s) hosts (localhost / a dev tunnel).
    if (protocol !== "http:" && protocol !== "https:") return [];
    return host ? [host] : [];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
};

export default nextConfig;
