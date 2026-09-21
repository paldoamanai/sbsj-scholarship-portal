import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseSettings } from "@/lib/settings";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: settingRows } = await supabase.from("system_settings").select("key, value");
  const settings = parseSettings(settingRows);

  if (settings.maintenance_mode) {
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (role?.role !== "admin") {
      return NextResponse.json({ error: settings.maintenance_message, code: "MAINTENANCE" }, { status: 503 });
    }
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const documentType = formData.get("document_type") as string | null;
  const applicationId = formData.get("application_id") as string | null;

  if (!file || !documentType) {
    return NextResponse.json(
      { error: "File and document_type are required" },
      { status: 400 }
    );
  }

  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Only PDF, JPG, and PNG files are allowed" },
      { status: 400 }
    );
  }

  if (file.size > settings.max_upload_mb * 1024 * 1024) {
    return NextResponse.json(
      { error: `File size must be under ${settings.max_upload_mb}MB` },
      { status: 400 }
    );
  }

  const filePath = `${user.id}/${documentType}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(filePath, file);

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage
    .from("documents")
    .getPublicUrl(filePath);

  const { data, error } = await supabase.from("documents").insert({
    user_id: user.id,
    application_id: applicationId,
    document_type: documentType,
    file_url: urlData.publicUrl,
    file_name: file.name,
  }).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
