
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  fetch: withSupabase(
    { auth: ["publishable"] },
    async (req, ctx) => {
      if (req.method !== "POST") {
        return jsonResponse(
          { error: "Method not allowed" },
          405,
        );
      }

      let body: unknown;

      try {
        body = await req.json();
      } catch {
        return jsonResponse(
          { error: "Invalid request body" },
          400,
        );
      }

      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body)
      ) {
        return jsonResponse(
          { error: "Invalid request body" },
          400,
        );
      }

      const credential = (
        body as Record<string, unknown>
      ).credential;

      if (
        typeof credential !== "string" ||
        credential.length < 40 ||
        credential.length > 100 ||
        !/^[A-Za-z0-9_-]+$/.test(credential)
      ) {
        return jsonResponse(
          { error: "Invalid or expired display credential" },
          401,
        );
      }

      const credentialHash = await sha256(credential);
      const now = new Date().toISOString();

      const { data: credentialRow, error: credentialError } =
        await ctx.supabaseAdmin
          .from("display_credentials")
          .select(
            "id, display_id, expires_at, revoked_at",
          )
          .eq("credential_hash", credentialHash)
          .is("revoked_at", null)
          .gt("expires_at", now)
          .maybeSingle();

      if (credentialError) {
        console.error(
          "authenticate-display: credential lookup failed",
        );

        return jsonResponse(
          { error: "Authentication temporarily unavailable" },
          500,
        );
      }

      if (!credentialRow) {
        return jsonResponse(
          { error: "Invalid or expired display credential" },
          401,
        );
      }

      const { data: display, error: displayError } =
        await ctx.supabaseAdmin
          .from("displays")
          .select(
            [
              "id",
              "display_code",
              "name",
              "location_label",
              "orientation",
              "resolution_width",
              "resolution_height",
              "timezone",
              "lifecycle_status",
              "desired_state",
              "player_version",
              "android_api_level",
              "capabilities",
            ].join(", "),
          )
          .eq("id", credentialRow.display_id)
          .maybeSingle();

      if (displayError) {
        console.error(
          "authenticate-display: display lookup failed",
        );

        return jsonResponse(
          { error: "Authentication temporarily unavailable" },
          500,
        );
      }

      if (
        !display ||
        display.lifecycle_status !== "active"
      ) {
        return jsonResponse(
          { error: "Display is not active" },
          403,
        );
      }

      const { error: updateError } =
        await ctx.supabaseAdmin
          .from("display_credentials")
          .update({ last_used_at: now })
          .eq("id", credentialRow.id)
          .is("revoked_at", null)
          .gt("expires_at", now);

      if (updateError) {
        console.error(
          "authenticate-display: last-used update failed",
        );

        return jsonResponse(
          { error: "Authentication temporarily unavailable" },
          500,
        );
      }

      return jsonResponse({
        ok: true,
        display: {
          id: display.id,
          display_code: display.display_code,
          name: display.name,
          location_label: display.location_label,
          orientation: display.orientation,
          resolution_width: display.resolution_width,
          resolution_height: display.resolution_height,
          timezone: display.timezone,
          desired_state: display.desired_state,
          player_version: display.player_version,
          android_api_level: display.android_api_level,
          capabilities: display.capabilities,
        },
        credential_expires_at: credentialRow.expires_at,
        server_time: now,
      });
    },
  ),
};
