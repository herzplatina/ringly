import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractServicesFromImage,
  extractServicesFromPdf,
} from "@/lib/menu-extraction";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file)
    return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BYTES)
    return NextResponse.json(
      { error: "File too large (max 10 MB)" },
      { status: 413 },
    );

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = file.type as string;

  let services;
  if (mimeType === "application/pdf") {
    services = await extractServicesFromPdf(base64);
  } else if (
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)
  ) {
    services = await extractServicesFromImage(
      base64,
      mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
    );
  } else {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }

  return NextResponse.json({ services });
}
