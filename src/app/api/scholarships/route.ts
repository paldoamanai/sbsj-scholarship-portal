import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Public listing: active programs with their availability, without the internal budget.
// Creating a program is done by the admin panel writing to Supabase directly, not through this route.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scholarships_public");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
