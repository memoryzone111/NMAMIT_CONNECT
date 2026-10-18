
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";

const SUPABASE_URL =
  "https://hkjwlrwwzaibswancvkr.supabase.co";

const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.SUPABASE_EMAIL;
const PASSWORD = process.env.SUPABASE_PASSWORD;

const DISPLAY_ID = "bdc6ceff-f6e2-45b5-97da-7d0d862a9809";
const DISPLAY_CODE = "NMC-5AA9FD7F51";

const secretDir = join(process.cwd(), ".local-secrets");
const pendingFile = join(secretDir, "pending-pairing.json");

if (!SUPABASE_KEY || !EMAIL || !PASSWORD) {
  console.error("Missing environment variables. Check your .env file.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

try {
  await mkdir(secretDir, { recursive: true, mode: 0o700 });
  await chmod(secretDir, 0o700);

  const { data: login, error: loginError } =
    await supabase.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });

  if (loginError || !login.session) {
    console.error("Sign-in failed. Check your account configuration.");
    process.exitCode = 1;
  } else {
    console.log("Owner sign-in successful.");
    console.log("Creating pairing session...");

    const { data, error } = await supabase.functions.invoke(
      "create-pairing-session",
      { body: { display_id: DISPLAY_ID } },
    );

    if (error) {
      console.error("Pairing request failed:", error.message);

      if (error.context instanceof Response) {
        console.error("HTTP status:", error.context.status);
      }

      process.exitCode = 1;
    } else if (
      data?.ok === true &&
      typeof data.pairing_code === "string" &&
      typeof data.session_id === "string"
    ) {
      const pending = {
        display_id: DISPLAY_ID,
        display_code: DISPLAY_CODE,
        pairing_code: data.pairing_code,
        session_id: data.session_id,
        expires_at: data.expires_at,
      };

      // Exclusive creation: don't overwrite an existing pending code.
      await writeFile(
        pendingFile,
        JSON.stringify(pending, null, 2) + "\n",
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await chmod(pendingFile, 0o600);

      console.log("Pairing session created and saved locally.");
      console.log("Display:", DISPLAY_CODE);
      console.log("Session ID:", data.session_id);
      console.log("Expires at:", data.expires_at);
      console.log("Pairing code was not printed.");
      console.log("Private file: .local-secrets/pending-pairing.json");
    } else {
      console.error("Unexpected response from pairing function.");
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    "Test error:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
} finally {
  await supabase.auth.signOut();
}
