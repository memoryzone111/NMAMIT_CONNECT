
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

function generateCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

      let body: Record<string, unknown>;

      try {
        const parsed: unknown = await req.json();

        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          return jsonResponse(
            { error: "Invalid request body" },
            400,
          );
        }

        body = parsed as Record<string, unknown>;
      } catch {
        return jsonResponse(
          { error: "Invalid JSON request" },
          400,
        );
      }

      const displayCode =
        typeof body.display_code === "string"
          ? body.display_code.trim().toUpperCase()
          : "";

      const pairingCode =
        typeof body.pairing_code === "string"
          ? body.pairing_code.trim().toUpperCase()
          : "";

      if (
        !/^NMC-[A-Z0-9]{10}$/.test(displayCode) ||
        !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(
          pairingCode,
        )
      ) {
        return jsonResponse(
          { error: "Invalid or expired pairing code" },
          400,
        );
      }

      const credential = generateCredential();

      const [codeHash, credentialHash] = await Promise.all([
        sha256(pairingCode),
        sha256(credential),
      ]);

      const { data, error } = await ctx.supabaseAdmin.rpc(
        "redeem_pairing_session_atomic",
        {
          p_display_code: displayCode,
          p_code_hash: codeHash,
          p_credential_hash: credentialHash,
        },
      );

      if (error) {
        // Avoid logging credentials, pairing codes, or secrets.
        console.error(
          "redeem-pairing-code: database redemption failed",
        );

        return jsonResponse(
          { error: "Pairing could not be completed" },
          500,
        );
      }

      const result = data as {
        ok?: boolean;
        display_id?: string;
        credential_id?: string;
        credential_expires_at?: string;
      } | null;

      if (
        !result?.ok ||
        !result.display_id ||
        !result.credential_id ||
        !result.credential_expires_at
      ) {
        return jsonResponse(
          { error: "Invalid or expired pairing code" },
          400,
        );
      }

      // The raw credential is returned only to the player once.
      // The database stores its SHA-256 hash, not this raw value.
      return jsonResponse(
        {
          ok: true,
          display_id: result.display_id,
          credential_id: result.credential_id,
          credential,
          credential_expires_at: result.credential_expires_at,
        },
        201,
      );
    },
  ),
};
