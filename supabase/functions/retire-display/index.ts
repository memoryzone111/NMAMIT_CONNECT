
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return respond({ error: "Authentication required" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anonKey || !serviceKey) {
    return respond({ error: "Server configuration missing" }, 500);
  }

  // Verify the signed-in user.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return respond({ error: "Invalid session" }, 401);
  }

  // Only the configured project owner can retire displays.
  if (user.id !== "4c38892e-2979-452e-a952-2545c841fa23") {
    return respond({ error: "Owner access required" }, 403);
  }

  let body: { display_id?: string };

  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid request body" }, 400);
  }

  if (!body.display_id) {
    return respond({ error: "display_id is required" }, 400);
  }

  // The service-role key is used only inside this server function.
  const adminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await adminClient
    .from("displays")
    .update({ lifecycle_status: "retired" })
    .eq("id", body.display_id)
    .select("id, display_code, lifecycle_status")
    .maybeSingle();

  if (error) {
    return respond({ error: error.message }, 400);
  }

  if (!data) {
    return respond({ error: "Display not found" }, 404);
  }

  return respond({ ok: true, display: data });
});

