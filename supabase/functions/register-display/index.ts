import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "Server configuration missing" }, 500);
  try {
    const body = await req.json();
    const displayCode = String(body.display_code ?? "").trim().toUpperCase();
    const credential = String(body.credential ?? "");
    if (!/^NMC-[A-Z0-9]{10}$/.test(displayCode)) return json({ ok: false, error: "Invalid display code" }, 400);
    if (credential.length < 40 || credential.length > 128) return json({ ok: false, error: "Invalid device credential" }, 400);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const credentialHash = await sha256(credential);
    const { data: existing, error: lookupError } = await admin.from("displays")
      .select("id,display_code,lifecycle_status").eq("display_code", displayCode).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      const { data: saved, error: credError } = await admin.from("display_credentials")
        .select("id").eq("display_id", existing.id).eq("credential_hash", credentialHash)
        .is("revoked_at", null).maybeSingle();
      if (credError) throw credError;
      if (!saved) return json({ ok: false, error: "Display code already belongs to another device. Reset app data to create a new display." }, 409);
      return json({ ok: true, display_id: existing.id, display_code: existing.display_code, lifecycle_status: existing.lifecycle_status, existing: true });
    }
    const { data: display, error: insertError } = await admin.from("displays").insert({
      display_code: displayCode,
      name: `Pending display ${displayCode}`,
      location_label: "",
      orientation: "landscape",
      timezone: "Asia/Kolkata",
      lifecycle_status: "registered",
      desired_state: "playing",
      player_version: String(body.player_version ?? "1.0.0").slice(0, 40),
      android_api_level: Number.isInteger(body.android_api_level) ? body.android_api_level : null,
      capabilities: { player: "android", enrollment: "device-generated-code" },
    }).select("id,display_code,lifecycle_status").single();
    if (insertError) throw insertError;
    const { error: credentialError } = await admin.from("display_credentials").insert({
      display_id: display.id, credential_hash: credentialHash, label: "Android player"
    });
    if (credentialError) {
      await admin.from("displays").delete().eq("id", display.id);
      throw credentialError;
    }
    return json({ ok: true, display_id: display.id, display_code: display.display_code, lifecycle_status: display.lifecycle_status, existing: false });
  } catch (error) {
    console.error("register-display failed:", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "Could not register device. Check server configuration and display schema." }, 500);
  }
});
