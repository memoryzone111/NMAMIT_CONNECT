
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const CODE_LENGTH = 10;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SESSION_LIFETIME_MS = 10 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Get the authenticated user's ID from the verified claims.
    const userId = ctx.userClaims?.id;

    if (!userId) {
      return json({ error: "Authentication required" }, 401);
    }

    let body: { display_id?: unknown };

    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const displayId = body.display_id;

    if (
      typeof displayId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        displayId,
      )
    ) {
      return json({ error: "A valid display_id UUID is required" }, 400);
    }

    // Verify the caller's active profile.
    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("profiles")
      .select("account_status")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed");
      return json({ error: "Unable to verify account" }, 500);
    }

    if (!profile || profile.account_status !== "active") {
      return json({ error: "Active account required" }, 403);
    }

    // Require an explicit owner or administrator role.
    const { data: roles, error: rolesError } = await ctx.supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["owner", "administrator"]);

    if (rolesError) {
      console.error("Role lookup failed");
      return json({ error: "Unable to verify permissions" }, 500);
    }

    if (!roles || roles.length === 0) {
      return json({ error: "Owner or administrator role required" }, 403);
    }

    // Only registered displays can begin pairing.
    const { data: display, error: displayError } = await ctx.supabaseAdmin
      .from("displays")
      .select("id, lifecycle_status")
      .eq("id", displayId)
      .maybeSingle();

    if (displayError) {
      console.error("Display lookup failed");
      return json({ error: "Unable to verify display" }, 500);
    }

    if (!display) {
      return json({ error: "Display not found" }, 404);
    }

    if (display.lifecycle_status !== "registered") {
      return json(
        { error: "Only registered displays can be paired" },
        409,
      );
    }

    // Generate a short-lived code and store only its SHA-256 hash.
    const code = generatePairingCode();
    const codeHash = await sha256(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

    const { data: session, error: insertError } = await ctx.supabaseAdmin
      .from("display_pairing_sessions")
      .insert({
        id: crypto.randomUUID(),
        display_id: displayId,
        code_hash: codeHash,
        created_by: userId,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        failed_attempts: 0,
      })
      .select("id, expires_at")
      .single();

    if (insertError || !session) {
      console.error("Pairing session creation failed");
      return json({ error: "Unable to create pairing session" }, 500);
    }

    // Return the plain code only to the authenticated administrator.
    return json(
      {
        ok: true,
        pairing_code: code,
        session_id: session.id,
        expires_at: session.expires_at,
        expires_in_seconds: SESSION_LIFETIME_MS / 1000,
      },
      201,
    );
  }),
};
