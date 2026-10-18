
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const supabaseUrl =
  "https://hkjwlrwwzaibswancvkr.supabase.co";

const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const credentialFile = join(
  process.cwd(),
  ".local-secrets",
  "display-credential.json",
);

if (!publishableKey) {
  console.error("SUPABASE_PUBLISHABLE_KEY is missing from .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

try {
  const savedText = await readFile(credentialFile, "utf8");
  const saved = JSON.parse(savedText);

  if (
    typeof saved.credential !== "string" ||
    !saved.credential ||
    typeof saved.display_id !== "string"
  ) {
    throw new Error("Saved credential file is incomplete.");
  }

  console.log("Testing display authentication...");

  const { data, error } = await supabase.functions.invoke(
    "authenticate-display",
    {
      body: {
        credential: saved.credential,
      },
    },
  );

  if (error) {
    console.error("Authentication request failed:", error.message);

    if (error.context instanceof Response) {
      console.error("HTTP status:", error.context.status);

      try {
        const response = await error.context.clone().json();
        console.error(
          "Server error:",
          response.error ?? "Unknown error",
        );
      } catch {
        console.error("Could not read server error response.");
      }
    }

    process.exitCode = 1;
  } else {
    console.log("Authentication response:", {
      ok: data?.ok,
      display_id: data?.display?.id,
      display_code: data?.display?.display_code,
      desired_state: data?.display?.desired_state,
      credential_expires_at: data?.credential_expires_at,
      server_time: data?.server_time,
    });

    if (data?.display?.id !== saved.display_id) {
      console.error("Returned display does not match saved credential.");
      process.exitCode = 1;
    } else if (data?.ok !== true) {
      console.error("Authentication was not successful.");
      process.exitCode = 1;
    } else {
      console.log("Player credential authenticated successfully.");
      console.log("Credential value was not printed.");
    }
  }
} catch (err) {
  console.error(
    "Test error:",
    err instanceof Error ? err.message : "Unknown error",
  );
  process.exitCode = 1;
}
