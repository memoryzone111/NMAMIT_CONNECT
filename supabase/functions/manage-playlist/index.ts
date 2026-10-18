import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const OWNER_UID = "4c38892e-2979-452e-a952-2545c841fa23";
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ ok: false, error: "Server configuration missing" }, 500);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "Sign in to the controller first" }, 401);
  try {
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ud, error: ue } = await user.auth.getUser();
    if (ue || !ud.user) return json({ ok: false, error: "Invalid controller session" }, 401);
    if (ud.user.id !== OWNER_UID) return json({ ok: false, error: "Owner access required" }, 403);
    const body = await req.json(), action = String(body.action || ""), displayId = String(body.display_id || "");
    if (!displayId) return json({ ok: false, error: "Display ID is required" }, 400);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: display, error: de } = await admin.from("displays").select("id").eq("id", displayId).maybeSingle();
    if (de) throw de;
    if (!display) return json({ ok: false, error: "Display not found" }, 404);
    if (action === "list") {
      const { data, error } = await admin.from("playlist_items").select("id,display_id,title,media_url,media_type,duration_seconds,position,created_at").eq("display_id", displayId).order("position", { ascending: true }).order("created_at", { ascending: true });
      if (error) throw error;
      return json({ ok: true, items: data || [] });
    }
    if (action === "add") {
      const title = String(body.title || "Media").trim().slice(0, 160) || "Media";
      const mediaUrl = String(body.media_url || "");
      const mediaType = String(body.media_type || "");
      const duration = Math.max(1, Math.min(3600, Math.floor(Number(body.duration_seconds || 10))));
      const path = String(body.storage_path || "");
      if (!mediaUrl.startsWith(url + "/storage/v1/object/public/signage-media/") || !path.startsWith(displayId + "/")) return json({ ok: false, error: "Invalid media storage path" }, 400);
      if (mediaType !== "image" && mediaType !== "video") return json({ ok: false, error: "Invalid media type" }, 400);
      const { data: current, error: ce } = await admin.from("playlist_items").select("position").eq("display_id", displayId).order("position", { ascending: false }).limit(1).maybeSingle();
      if (ce) throw ce;
      const { data, error } = await admin.from("playlist_items").insert({ display_id: displayId, title, media_url: mediaUrl, media_type: mediaType, duration_seconds: duration, position: Number(current?.position ?? -1) + 1 }).select("id,display_id,title,media_url,media_type,duration_seconds,position,created_at").single();
      if (error) throw error;
      return json({ ok: true, item: data });
    }
    if (action === "delete") {
      const itemId = String(body.item_id || "");
      const { data: item, error: ie } = await admin.from("playlist_items").select("id,media_url").eq("id", itemId).eq("display_id", displayId).maybeSingle();
      if (ie) throw ie;
      if (!item) return json({ ok: false, error: "Playlist item not found" }, 404);
      const { error: de2 } = await admin.from("playlist_items").delete().eq("id", itemId).eq("display_id", displayId);
      if (de2) throw de2;
      const marker = "/storage/v1/object/public/signage-media/";
      const ix = String(item.media_url).indexOf(marker);
      if (ix >= 0) { const path = decodeURIComponent(String(item.media_url).slice(ix + marker.length)); await admin.storage.from("signage-media").remove([path]); }
      return json({ ok: true });
    }
    if (action === "reorder") {
      const ids = Array.isArray(body.item_ids) ? body.item_ids.map(String) : [];
      if (ids.length > 500) return json({ ok: false, error: "Playlist is too large to reorder" }, 400);
      for (let i = 0; i < ids.length; i++) {
        const { error } = await admin.from("playlist_items").update({ position: i }).eq("id", ids[i]).eq("display_id", displayId);
        if (error) throw error;
      }
      return json({ ok: true });
    }
    return json({ ok: false, error: "Unknown playlist action" }, 400);
  } catch (e) {
    console.error("manage-playlist failed", e instanceof Error ? e.message : "unknown error");
    return json({ ok: false, error: "Playlist operation failed", details: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400) }, 500);
  }
});
