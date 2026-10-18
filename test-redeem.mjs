
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  readFile,
  writeFile,
  chmod,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

const SUPABASE_URL =
  "https://hkjwlrwwzaibswancvkr.supabase.co";

const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

const secretDir = join(process.cwd(), ".local-secrets");
const pendingFile = join(secretDir, "pending-pairing.json");
const credentialFile = join(secretDir, "display-credential.json");

if (!SUPABASE_KEY) {
  console.error("SUPABASE_PUBLISHABLE_KEY is missing from .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

async function main() {
  // Do not overwrite a credential that may already be in use.
  try {
    await readFile(credentialFile);
    throw new Error(
      "Credential file already exists. Keeping it unchanged.",
    );
  } catch (fileError) {
    if (fileError.code !== "ENOENT") {
      throw fileError;
    }
  }

  const pendingText = await readFile(pendingFile, "utf8");
  const pending = JSON.parse(pendingText);

  if (
    !pending.display_code ||
    !pending.pairing_code ||
    !pending.display_id
  ) {
    throw new Error("Pending pairing file is incomplete.");
  }

  if (
    pending.expires_at &&
    Date.parse(pending.expires_at) <= Date.now()
  ) {
    throw new Error(
      "Pairing session expired. Create a fresh pairing session.",
    );
  }

  console.log("Redeeming the saved pairing code...");

  const {
    data: redemption,
    error: redemptionError,
  } = await supabase.functions.invoke("redeem-pairing-code", {
    body: {
      display_code: pending.display_code,
      pairing_code: pending.pairing_code,
    },
  });

  if (redemptionError) {
    console.error("Redemption failed:", redemptionError.message);

    if (redemptionError.context instanceof Response) {
      console.error("HTTP status:", redemptionError.context.status);
    }

    process.exitCode = 1;
    return;
  }

  if (
    redemption?.ok !== true ||
    typeof redemption.credential !== "string" ||
    !redemption.credential ||
    redemption.display_id !== pending.display_id ||
    typeof redemption.credential_id !== "string"
  ) {
    throw new Error(
      "Unexpected redemption response. Credential was not saved.",
    );
  }

  const credentialData = {
    credential: redemption.credential,
    display_id: redemption.display_id,
    credential_id: redemption.credential_id,
    credential_expires_at: redemption.credential_expires_at,
  };

  // Exclusive file creation; never overwrite an existing credential.
  await writeFile(
    credentialFile,
    JSON.stringify(credentialData, null, 2) + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );

  await chmod(credentialFile, 0o600);

  // Remove the pending code only after the credential is saved.
  await unlink(pendingFile);

  console.log("Pairing redemption successful.");
  console.log("Credential saved locally.");
  console.log("Display ID:", redemption.display_id);
  console.log("Credential ID:", redemption.credential_id);
  console.log("Expires at:", redemption.credential_expires_at);
  console.log("Credential value was not printed.");
  console.log("Saved to .local-secrets/display-credential.json");
}

main().catch((caughtError) => {
  console.error(
    "Test error:",
    caughtError instanceof Error
      ? caughtError.message
      : "Unknown error",
  );
  process.exitCode = 1;
});
