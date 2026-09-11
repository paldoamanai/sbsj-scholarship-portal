import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.SB_URL;
const key = process.env.SB_ANON_KEY;
const supabase = createClient(url, key, { realtime: { transport: ws } });

const channel = supabase
  .channel("verify-scholarships")
  .on("postgres_changes", { event: "*", schema: "public", table: "scholarships" }, (payload) => {
    console.log("EVENT_RECEIVED", JSON.stringify({ type: payload.eventType, id: (payload.new || payload.old)?.id }));
  })
  .subscribe((status, err) => {
    console.log("STATUS", status, err ? err.message : "");
  });

setTimeout(() => {
  console.log("DONE_WAITING");
  process.exit(0);
}, 120000);
