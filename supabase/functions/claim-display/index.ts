import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const OWNER_UID = "4c38892e-2979-452e-a952-2545c841fa23";
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ ok: false, error: "Server configuration missing" }, 500);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Sign in to the controller first" }, 401);
  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: "Invalid controller session" }, 401);
    if (userData.user.id !== OWNER_UID) return json({ ok: false, error: "Owner access required" }, 403);
    const body = await req.json();
    const displayCode = String(body.display_code ?? "").trim().toUpperCase();
    const qrCode = String(body.qr_code ?? "").trim();
    const name = String(body.name ?? "").trim().slice(0, 120);
    const location = String(body.location_label ?? "").trim().slice(0, 160);
    if (!/^NMC-[A-Z0-9]{10}$/.test(displayCode) || !/^\d{6}$/.test(qrCode)) return json({ ok: false, error: "Invalid QR pairing data" }, 400);
    if (!name) return json({ ok: false, error: "Enter a display name" }, 400);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: display, error: findError } = await admin.from("displays").select("id,display_code,lifecycle_status")
      .eq("display_code", displayCode).maybeSingle();
    if (findError) throw findError;
    if (!display) return json({ ok: false, error: "Display registration not found. Keep it online and rescan its current QR." }, 404);
    if (display.lifecycle_status === "active") return json({ ok: true, already_active: true, display_id: display.id, display_code: display.display_code });
    if (display.lifecycle_status !== "registered") return json({ ok: false, error: `Display cannot be activated from status: ${display.lifecycle_status}` }, 409);
    const hash = await sha256(qrCode);
    const { data: session, error: sessionError } = await admin.from("display_pairing_sessions")
      .select("id,expires_at,failed_attempts").eq("display_id", display.id).eq("code_hash", hash)
      .is("redeemed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) {
      // Increment the current live challenge's attempt counter to discourage guessing.
      const { data: current, error: currentError } = await admin.from("display_pairing_sessions")
        .select("id,failed_attempts").eq("display_id", display.id).is("redeemed_at", null)
        .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (currentError) throw currentError;
      if (current && current.failed_attempts < 5) {
        await admin.from("display_pairing_sessions").update({ failed_attempts: current.failed_attempts + 1 }).eq("id", current.id);
      }
      return json({ ok: false, error: "QR code expired or incorrect. Scan the latest QR shown on the display." }, 401);
    }
    if (session.failed_attempts >= 5) return json({ ok: false, error: "Too many attempts. Scan the latest QR shown on the display." }, 429);
    const { data: updated, error: updateError } = await admin.from("displays").update({
      name, location_label: location, created_by: userData.user.id, lifecycle_status: "active"
    }).eq("id", display.id).eq("lifecycle_status", "registered")
      .select("id,display_code,name,location_label,lifecycle_status").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return json({ ok: false, error: "Display state changed. Refresh the controller and try again." }, 409);
    const { error: redeemError } = await admin.from("display_pairing_sessions")
      .update({ redeemed_at: new Date().toISOString(), redeemed_by: userData.user.id }).eq("id", session.id).is("redeemed_at", null);
    if (redeemError) throw redeemError;
    return json({ ok: true, display: updated });
  } catch (error) {
    console.error("claim-display failed:", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "Could not activate display. Verify the existing schema and server secrets." }, 500);
  }
});
