import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Optional paid AI-image detector (Sightengine's "genai" model). Off unless SIGHTENGINE_API_USER and
// SIGHTENGINE_API_SECRET are set on the server. The score is only a hint for the reviewer: detectors
// misfire on blurry phone photos, so it never blocks anything on its own.
//   GET                                    { enabled }
//   POST multipart { documentId, image }   the reviewer's browser sends a JPEG of the image or PDF page;
//                                          returns { score, flags, needs_original }

const USER = process.env.SIGHTENGINE_API_USER;
const SECRET = process.env.SIGHTENGINE_API_SECRET;

export async function GET() {
  return NextResponse.json({ enabled: !!(USER && SECRET) });
}

export async function POST(request: Request) {
  if (!USER || !SECRET) return NextResponse.json({ error: "The AI detector isn't set up" }, { status: 501 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: canReview } = await supabase.rpc("staff_may", { _user: user.id, _perm: "review" });
  if (canReview !== true) return NextResponse.json({ error: "Only reviewers and admins can do this" }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const documentId = form?.get("documentId");
  const image = form?.get("image");
  if (typeof documentId !== "string" || !(image instanceof Blob) || image.size === 0) {
    return NextResponse.json({ error: "Send documentId and image" }, { status: 400 });
  }
  if (image.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Image too large" }, { status: 413 });
  // The reviewer must be able to see the document (row-level security limits office staff to their own).
  const { data: doc } = await supabase.from("documents").select("id").eq("id", documentId).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const body = new FormData();
  body.append("media", image, "document.jpg");
  body.append("models", "genai");
  body.append("api_user", USER);
  body.append("api_secret", SECRET);
  const res = await fetch("https://api.sightengine.com/1.0/check.json", { method: "POST", body });
  const out = (await res.json().catch(() => null)) as { status?: string; type?: { ai_generated?: number }; error?: { message?: string } } | null;
  const score = out?.type?.ai_generated;
  if (!res.ok || out?.status !== "success" || typeof score !== "number") {
    return NextResponse.json({ error: out?.error?.message ?? "The AI detector didn't answer" }, { status: 502 });
  }

  const { data, error } = await supabase.rpc("record_ai_score", { _id: documentId, _score: score });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ score, ...(data?.[0] ?? {}) });
}
