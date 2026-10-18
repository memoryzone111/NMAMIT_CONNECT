
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

try {
  const { data, error } = await supabase.functions.invoke(
    "authenticate-display",
    {
      body: {
        credential: "invalid-test-credential-not-real",
      },
    },
  );

  if (error) {
    const status = error.context instanceof Response
      ? error.context.status
      : "unknown";

    console.log("Invalid credential rejected.");
    console.log("HTTP status:", status);

    if (status !== 401) {
      console.log("Expected HTTP 401; investigate this response.");
      process.exitCode = 1;
    } else {
      console.log("PASS: invalid credential returns HTTP 401.");
    }
  } else {
    console.error(
      "FAIL: invalid credential was unexpectedly accepted.",
    );
    console.log("Response ok:", data?.ok);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(
    "Test failed:",
    err instanceof Error ? err.message : "Unknown error",
  );
  process.exitCode = 1;
}
