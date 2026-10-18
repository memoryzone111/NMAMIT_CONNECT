import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    const qrCode = String(body.qr_code ?? "");
    if (!/^NMC-[A-Z0-9]{10}$/.test(displayCode) || !/^\d{6}$/.test(qrCode)) return json({ ok: false, error: "Invalid display or QR code" }, 400);
    if (credential.length < 40 || credential.length > 128) return json({ ok: false, error: "Invalid device credential" }, 400);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const credentialHash = await sha256(credential);
    const { data: display, error: displayError } = await admin.from("displays").select("id,display_code,lifecycle_status").eq("display_code", displayCode).maybeSingle();
    if (displayError) throw displayError;
    if (!display) return json({ ok: false, error: "Display registration not found" }, 404);
    const { data: savedCredential, error: credentialError } = await admin.from("display_credentials").select("id")
      .eq("display_id", display.id).eq("credential_hash", credentialHash).is("revoked_at", null).maybeSingle();
    if (credentialError) throw credentialError;
    if (!savedCredential) return json({ ok: false, error: "Device authentication failed" }, 401);
    if (display.lifecycle_status === "active") return json({ ok: true, active: true, expires_at: null });
    if (display.lifecycle_status !== "registered") return json({ ok: false, error: "Display is not available for pairing" }, 409);
    // Invalidate any earlier QR code for this display. No schema change is required.
    const { error: deleteError } = await admin.from("display_pairing_sessions").delete()
      .eq("display_id", display.id).is("redeemed_at", null);
    if (deleteError) throw deleteError;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { error: insertError } = await admin.from("display_pairing_sessions").insert({
      display_id: display.id, code_hash: await sha256(qrCode), expires_at: expiresAt, created_by: null
    });
    if (insertError) throw insertError;
    return json({ ok: true, active: false, expires_at: expiresAt });
  } catch (error) {
    console.error("rotate-display-qr failed:", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "Could not refresh QR code. Verify pairing-session schema and server secrets." }, 500);
  }
});
