import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
// Try several methods to nudge schema cache reload
const r = await fetch(
  process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/",
  {
    method: "GET",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Accept-Profile": "public",
    },
  }
);
const txt = await r.text();
const j = JSON.parse(txt);
console.log("tables:", Object.keys(j.definitions || {}).sort().join(","));
