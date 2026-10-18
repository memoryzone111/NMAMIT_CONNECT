import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json({ ok: false, error: "Server configuration missing" }, 500);
  }

  try {
    const body = await req.json();
    const oldCode = String(body.old_display_code ?? "").trim().toUpperCase();
    const oldCredential = String(body.old_credential ?? "");
    const newCode = String(body.new_display_code ?? "").trim().toUpperCase();
    const newCredential = String(body.new_credential ?? "");

    if (
      !/^NMC-[A-Z0-9]{10}$/.test(oldCode) ||
      !/^NMC-[A-Z0-9]{10}$/.test(newCode) ||
      oldCode === newCode ||
      oldCredential.length < 40 ||
      oldCredential.length > 128 ||
      newCredential.length < 40 ||
      newCredential.length > 128
    ) {
      return json({ ok: false, error: "Invalid rotation request" }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: oldDisplay, error: oldError } = await admin
      .from("displays")
      .select("id,display_code,lifecycle_status")
      .eq("display_code", oldCode)
      .maybeSingle();

    if (oldError) throw oldError;
    if (!oldDisplay) {
      return json({ ok: false, error: "Previous registration not found" }, 404);
    }

    const { data: savedCredential, error: credentialError } = await admin
      .from("display_credentials")
      .select("id")
      .eq("display_id", oldDisplay.id)
      .eq("credential_hash", await sha256(oldCredential))
      .is("revoked_at", null)
      .maybeSingle();

    if (credentialError) throw credentialError;
    if (!savedCredential) {
      return json({ ok: false, error: "Device authentication failed" }, 401);
    }

    if (oldDisplay.lifecycle_status === "active") {
      return json({
        ok: false,
        active: true,
        error: "Display is paired; its identity must not rotate",
      }, 409);
    }

    if (oldDisplay.lifecycle_status !== "registered") {
      return json({
        ok: false,
        error: `Cannot rotate a display in status ${oldDisplay.lifecycle_status}`,
      }, 409);
    }

    const { data: existingNew, error: newLookupError } = await admin
      .from("displays")
      .select("id")
      .eq("display_code", newCode)
      .maybeSingle();

    if (newLookupError) throw newLookupError;
    if (existingNew) {
      return json({ ok: false, error: "New display code already exists" }, 409);
    }

    const { data: newDisplay, error: insertError } = await admin
      .from("displays")
      .insert({
        display_code: newCode,
        name: `Pending display ${newCode}`,
        location_label: "",
        orientation: "landscape",
        timezone: "Asia/Kolkata",
        lifecycle_status: "registered",
        desired_state: "playing",
        player_version: String(body.player_version ?? "1.0.0").slice(0, 40),
        android_api_level: Number.isInteger(body.android_api_level)
          ? body.android_api_level
          : null,
        capabilities: { player: "android", enrollment: "device-generated-code" },
      })
      .select("id,display_code,lifecycle_status")
      .single();

    if (insertError) throw insertError;

    const { error: newCredentialError } = await admin
      .from("display_credentials")
      .insert({
        display_id: newDisplay.id,
        credential_hash: await sha256(newCredential),
        label: "Android player",
      });

    if (newCredentialError) {
      await admin.from("displays")
        .update({ lifecycle_status: "retired" })
        .eq("id", newDisplay.id);
      throw newCredentialError;
    }

    // Compare-and-set: retire the old display only if it is still unpaired.
    const { data: retiredOld, error: retireError } = await admin
      .from("displays")
      .update({ lifecycle_status: "retired" })
      .eq("id", oldDisplay.id)
      .eq("lifecycle_status", "registered")
      .select("id")
      .maybeSingle();

    if (retireError || !retiredOld) {
      await admin.from("displays")
        .update({ lifecycle_status: "retired" })
        .eq("id", newDisplay.id);
      await admin.from("display_credentials")
        .update({ revoked_at: new Date().toISOString() })
        .eq("display_id", newDisplay.id)
        .is("revoked_at", null);

      if (retireError) throw retireError;
      return json({
        ok: false,
        error: "Previous display changed state. Rotation cancelled; refresh device status.",
      }, 409);
    }

    return json({
      ok: true,
      display_id: newDisplay.id,
      display_code: newDisplay.display_code,
      lifecycle_status: newDisplay.lifecycle_status,
    });
  } catch (error) {
    console.error(
      "rotate-display-registration failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ ok: false, error: "Registration rotation failed" }, 500);
  }
});
