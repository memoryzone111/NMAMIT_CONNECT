(() => {
  "use strict";

  const cfg = window.NMAMIT_CONFIG || {};
  const $ = id => document.getElementById(id);

  const validConfig =
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    cfg.SUPABASE_ANON_KEY.length > 0 &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

  let sb = null;
  let displays = [];
  let selectedDisplay = null;
  let latestPairing = null;

  const say = message => {
    const notice = $("notice");
    if (notice) notice.textContent = message;
  };

  const connected = (ok, label) => {
    const connection = $("connection");
    if (!connection) return;

    const text = label || (ok ? "CONNECTED" : "OFFLINE");
    connection.textContent = text;
    connection.style.color = ok ? "#d8ff63" : "#ff8d82";
    connection.dataset.state = label === "READY" ? "ready" : (ok ? "connected" : "offline");
  };

  function showDashboard(show) {
    $("loginPanel")?.classList.toggle("hidden", show);
    $("dashboard")?.classList.toggle("hidden", !show);
    if (show) {
      ensureDeviceRegistrationUI();
      ensureMediaManagerUI();
      if (typeof handleIncomingQrUrl === "function") handleIncomingQrUrl();
    }
  }

  function errorMessage(error, fallback = "Something went wrong.") {
    return error?.message || error?.error_description || fallback;
  }

  async function loadDisplays() {
    if (!sb) throw new Error("Supabase client is not ready.");

    say("Loading displays…");
    $("displayList").textContent = "Loading displays…";

    const { data, error } = await sb
      .from("displays")
      .select("id,display_code,name,location_label,lifecycle_status,desired_state,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    displays = data || [];
    renderDisplays();
    refreshMediaDisplayOptions();
    connected(true);
    say(displays.length
      ? "Displays loaded. Registered displays can be paired with an Android player."
      : "No displays are visible to this account. Registration may require an authorized backend workflow.");
  }

  function renderDisplays() {
    const list = $("displayList");
    if (!list) return;
    list.replaceChildren();

    if (!displays.length) {
      list.textContent = "No displays available for this account.";
      return;
    }

    displays.forEach(display => {
      const card = document.createElement("article");
      card.className = "display-card";

      const info = document.createElement("div");
      info.className = "display-info";

      const name = document.createElement("h3");
      name.textContent = display.name || "Unnamed display";

      const code = document.createElement("p");
      code.className = "code";
      code.textContent = display.display_code || "No display code";

      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent =
        `${display.location_label || "No location"} · ${display.desired_state || "unknown state"}`;

      const status = document.createElement("span");
      status.className = "tag";
      status.textContent = display.lifecycle_status || "unknown";

      info.append(name, code, detail, status);

      const actions = document.createElement("div");
      actions.className = "display-actions";

      const pairButton = document.createElement("button");
      pairButton.className = "primary";
      pairButton.textContent = display.lifecycle_status === "registered"
        ? "Generate pairing code"
        : display.lifecycle_status === "active"
          ? "Already paired"
          : "Unavailable";
      pairButton.disabled = display.lifecycle_status !== "registered";
      pairButton.addEventListener("click", () => createPairing(display));

      const retireButton = document.createElement("button");
      retireButton.className = "secondary";
      retireButton.textContent = display.lifecycle_status === "retired" ? "Retired" : "Remove / Retire";
      retireButton.disabled = display.lifecycle_status === "retired";
      retireButton.addEventListener("click", () => retireDisplay(display));

      actions.append(pairButton, retireButton);
      card.append(info, actions);
      list.append(card);
    });
  }

  async function createPairing(display) {
    selectedDisplay = display;
    latestPairing = null;
    $("pairPanel").classList.remove("hidden");
    $("pairTitle").textContent = display.name || "Pair display";
    $("pairDetails").textContent = "Requesting a temporary pairing code…";
    $("displayCode").textContent = display.display_code || "Unavailable";
    $("pairingCode").textContent = "Generating…";
    $("expiry").textContent = "";
    say("Creating pairing session…");

    try {
      const { data, error } = await sb.functions.invoke(
        "create-pairing-session",
        { body: { display_id: display.id } }
      );

      if (error) {
        let details = error.message || "Pairing request failed.";
        if (error.context && typeof error.context.clone === "function") {
          try {
            const response = await error.context.clone().json();
            if (response.message) details = response.message;
            else if (response.error) details = response.error;
          } catch (_) {
            // Keep the SDK error message when the response is not JSON.
          }
        }
        throw new Error(details);
      }

      if (!data || data.ok !== true || !data.pairing_code) {
        throw new Error(data?.error || data?.message || "Unexpected pairing response.");
      }

      latestPairing = {
        display_code: display.display_code,
        pairing_code: data.pairing_code
      };

      $("pairingCode").textContent = data.pairing_code;
      $("expiry").textContent = data.expires_at
        ? `Expires: ${new Date(data.expires_at).toLocaleString()}`
        : "Temporary code generated.";
      $("pairDetails").textContent =
        "On Android, enter the display code and this temporary pairing code.";
      say("Pairing code created. Enter it in the Android player.");

      await loadDisplays();
    } catch (error) {
      $("pairingCode").textContent = "Not generated";
      $("pairDetails").textContent = errorMessage(error, "Pairing failed.");
      say(`Pairing failed: ${errorMessage(error, "Unknown error.")}`);
    }
  }


  // Media uploads use short-lived signed Storage URLs. Playlist mutations are
  // performed by owner-verified Edge Functions, never direct anonymous writes.
  let mediaItems = [];
  let mediaBusy = false;
  function ensureMediaManagerUI() {
    const dashboard = $("dashboard");
    if (!dashboard || $("mediaManagerPanel")) return;
    const panel = document.createElement("section");
    panel.id = "mediaManagerPanel";
    panel.className = "panel";
    panel.style.cssText = "margin:18px 0;padding:20px;border:1px solid var(--border,#333);border-radius:14px;";
    panel.innerHTML = `
      <h2 style="margin:0 0 6px">Media & Playlist</h2>
      <p class="muted">Upload images or videos to an active display. Changes sync to the Android player automatically.</p>
      <label for="mediaDisplaySelect">Active display</label>
      <select id="mediaDisplaySelect" style="display:block;width:100%;max-width:520px;padding:12px;margin:8px 0 14px;border-radius:9px;background:var(--surface,#111);color:inherit;border:1px solid var(--border,#444)"></select>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div style="flex:1 1 240px"><label for="mediaFileInput">Image or video file (max 200 MB)</label><input id="mediaFileInput" type="file" accept="image/*,video/*" style="display:block;width:100%;padding:10px;margin-top:8px;box-sizing:border-box"></div>
        <div style="width:140px"><label for="mediaDurationInput">Image duration (sec)</label><input id="mediaDurationInput" type="number" min="1" max="3600" value="10" style="width:100%;padding:10px;margin-top:8px;box-sizing:border-box"></div>
        <button type="button" class="primary" id="uploadMediaBtn">Upload & add</button>
      </div>
      <p id="mediaHelp" class="muted" role="status" aria-live="polite"></p>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px"><h3 style="margin:0">Playlist</h3><button type="button" class="secondary" id="refreshMediaBtn">Refresh playlist</button></div>
      <div id="mediaPlaylist" style="display:grid;gap:10px;margin-top:12px">Choose an active display.</div>`;
    const displayList = $("displayList");
    if (displayList?.parentElement) displayList.parentElement.insertBefore(panel, displayList);
    else dashboard.append(panel);
    $("mediaDisplaySelect").addEventListener("change", () => loadMediaPlaylist());
    $("refreshMediaBtn").addEventListener("click", () => loadMediaPlaylist());
    $("uploadMediaBtn").addEventListener("click", uploadMedia);
    refreshMediaDisplayOptions();
  }
  function mediaMessage(message) { if ($("mediaHelp")) $("mediaHelp").textContent = message; }
  function selectedMediaDisplay() { return displays.find(d => d.id === $("mediaDisplaySelect")?.value && d.lifecycle_status === "active") || null; }
  function refreshMediaDisplayOptions() {
    const select = $("mediaDisplaySelect");
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    const active = displays.filter(d => d.lifecycle_status === "active");
    if (!active.length) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "No active displays — pair a display first"; select.append(option);
      if ($("mediaPlaylist")) $("mediaPlaylist").textContent = "Pair a display to manage its playlist.";
      return;
    }
    active.forEach(d => { const o = document.createElement("option"); o.value = d.id; o.textContent = `${d.name || d.display_code} (${d.display_code || d.id})`; select.append(o); });
    if (active.some(d => d.id === previous)) select.value = previous;
    loadMediaPlaylist();
  }
  async function playlistRequest(body) {
    const { data, error } = await sb.functions.invoke("manage-playlist", { body });
    if (error) {
      let detail = error.message || "Playlist request failed.";
      if (error.context?.clone) { try { const r = await error.context.clone().json(); detail = r.error || r.message || detail; } catch (_) {} }
      throw new Error(detail);
    }
    if (!data?.ok) throw new Error(data?.error || "Playlist request failed.");
    return data;
  }
  async function loadMediaPlaylist() {
    const display = selectedMediaDisplay();
    const list = $("mediaPlaylist");
    if (!list || !display || !sb) { if (list) list.textContent = "Choose an active display."; return; }
    list.textContent = "Loading playlist…";
    try {
      const result = await playlistRequest({ action: "list", display_id: display.id });
      if (selectedMediaDisplay()?.id !== display.id) return;
      mediaItems = result.items || [];
      renderMediaPlaylist();
    } catch (error) { list.textContent = `Could not load playlist: ${errorMessage(error)}`; }
  }
  function renderMediaPlaylist() {
    const list = $("mediaPlaylist"); if (!list) return;
    list.replaceChildren();
    if (!mediaItems.length) { list.textContent = "No media yet. Upload an image or video above."; return; }
    mediaItems.forEach((item, index) => {
      const row = document.createElement("article");
      row.style.cssText = "display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px;border:1px solid var(--border,#333);border-radius:12px;";
      const preview = item.media_type === "video" ? document.createElement("video") : document.createElement("img");
      preview.src = item.media_url; preview.style.cssText = "width:100px;height:68px;object-fit:cover;border-radius:7px;background:#111";
      if (item.media_type === "video") { preview.muted = true; preview.playsInline = true; preview.controls = true; }
      const info = document.createElement("div"); info.style.cssText = "flex:1 1 160px;min-width:0";
      const title = document.createElement("strong"); title.textContent = item.title || "Untitled media"; title.style.display = "block";
      const meta = document.createElement("small"); meta.className = "muted"; meta.textContent = `${item.media_type.toUpperCase()} · Position ${index + 1}${item.media_type === "image" ? ` · ${item.duration_seconds}s` : ""}`;
      info.append(title, meta);
      const controls = document.createElement("div"); controls.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      const up = document.createElement("button"); up.type = "button"; up.className = "secondary"; up.textContent = "↑"; up.title = "Move up"; up.disabled = index === 0; up.addEventListener("click", () => moveMedia(index, -1));
      const down = document.createElement("button"); down.type = "button"; down.className = "secondary"; down.textContent = "↓"; down.title = "Move down"; down.disabled = index === mediaItems.length - 1; down.addEventListener("click", () => moveMedia(index, 1));
      const del = document.createElement("button"); del.type = "button"; del.className = "secondary"; del.textContent = "Remove"; del.addEventListener("click", () => removeMedia(item));
      controls.append(up, down, del); row.append(preview, info, controls); list.append(row);
    });
  }
  async function moveMedia(index, delta) {
    const next = index + delta; if (next < 0 || next >= mediaItems.length) return;
    const copy = [...mediaItems]; [copy[index], copy[next]] = [copy[next], copy[index]];
    try { await playlistRequest({ action: "reorder", display_id: selectedMediaDisplay()?.id, item_ids: copy.map(x => x.id) }); await loadMediaPlaylist(); mediaMessage("Playlist order updated."); }
    catch (error) { mediaMessage(`Could not reorder playlist: ${errorMessage(error)}`); }
  }
  async function removeMedia(item) {
    const display = selectedMediaDisplay(); if (!display || !confirm(`Remove “${item.title}” from this playlist?`)) return;
    try { await playlistRequest({ action: "delete", display_id: display.id, item_id: item.id }); await loadMediaPlaylist(); mediaMessage("Media removed."); }
    catch (error) { mediaMessage(`Could not remove media: ${errorMessage(error)}`); }
  }
  async function uploadMedia() {
    if (mediaBusy) return;
    const display = selectedMediaDisplay(), file = $("mediaFileInput")?.files?.[0];
    if (!display) return mediaMessage("Select an active display first.");
    if (!file) return mediaMessage("Choose an image or video file first.");
    if (file.size <= 0 || file.size > 200 * 1024 * 1024) return mediaMessage("File must be smaller than 200 MB.");
    if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) return mediaMessage("Only image and video files are supported.");
    mediaBusy = true; $("uploadMediaBtn").disabled = true; mediaMessage("Preparing secure upload…");
    try {
      const { data: signed, error } = await sb.functions.invoke("create-media-upload-url", { body: { display_id: display.id, filename: file.name, content_type: file.type, size: file.size } });
      if (error) {
        let detail = error.message || "Could not prepare upload.";
        if (error.context?.clone) { try { const r = await error.context.clone().json(); detail = r.error || r.message || detail; } catch (_) {} }
        throw new Error(detail);
      }
      if (!signed?.ok || !signed.path || !signed.token) throw new Error(signed?.error || "Upload URL was not returned.");
      mediaMessage("Uploading file… keep this page open.");
      const { error: uploadError } = await sb.storage.from("signage-media").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const mediaUrl = sb.storage.from("signage-media").getPublicUrl(signed.path).data.publicUrl;
      const mediaType = file.type.startsWith("video/") ? "video" : "image";
      const duration = Math.max(1, Math.min(3600, Number.parseInt($("mediaDurationInput").value || "10", 10) || 10));
      await playlistRequest({ action: "add", display_id: display.id, title: file.name.replace(/\.[^.]+$/, ""), media_url: mediaUrl, media_type: mediaType, duration_seconds: duration, storage_path: signed.path });
      $("mediaFileInput").value = ""; mediaMessage("Upload complete. The Android display will sync shortly."); await loadMediaPlaylist();
    } catch (error) { mediaMessage(`Upload failed: ${errorMessage(error)}. If the storage bucket is missing, create the existing signage-media bucket in Supabase Storage; no database schema change is needed.`); }
    finally { mediaBusy = false; $("uploadMediaBtn").disabled = false; }
  }

  // Retiring a display is performed by a protected Edge Function, not by
  // a direct browser-side UPDATE against the displays table.
  async function retireDisplay(display) {
    const active = display.lifecycle_status === "active";
    const warning = active
      ? "\n\nThis display is ACTIVE. Retiring it may stop its player from authenticating."
      : "";

    const displayName = display.name || "Unnamed display";
    if (!confirm(
      `Retire "${displayName}" (${display.display_code || display.id})?${warning}\n\nThis does not delete the database record.`
    )) return;

    try {
      say(`Retiring ${display.display_code || displayName}…`);

      const { data, error } = await sb.functions.invoke("retire-display", {
        body: { display_id: display.id }
      });

      if (error) {
        let details = error.message || "The retire request failed.";
        if (error.context && typeof error.context.clone === "function") {
          try {
            const response = await error.context.clone().json();
            if (response.error) details = response.error;
            else if (response.message) details = response.message;
          } catch (_) {
            // Keep the SDK error message.
          }
        }
        throw new Error(details);
      }

      if (!data || data.ok !== true) {
        throw new Error(data?.error || "The server did not confirm retirement.");
      }

      say(`${display.display_code || displayName} retired successfully.`);
      await loadDisplays();
    } catch (error) {
      const message = errorMessage(error, "Could not retire display.");
      say(`Could not retire display: ${message}`);

      if (/Server configuration missing/i.test(message)) {
        say("Retirement is not configured on the server. Check the retire-display Edge Function secrets in Supabase.");
      } else if (/Owner access required/i.test(message)) {
        say("Retirement denied: the signed-in account is not authorized as the configured project owner.");
      }
    }
  }

  // Registration / claiming is routed through protected Edge Functions, never a direct table insert.
  function ensureDeviceRegistrationUI() {
    const dashboard = $("dashboard");
    if (!dashboard || $("deviceRegistrationPanel")) return;
    const panel = document.createElement("section");
    panel.id = "deviceRegistrationPanel";
    panel.className = "panel";
    panel.style.cssText = "margin:18px 0;padding:18px;border:1px solid var(--border,#333);border-radius:14px;";
    panel.innerHTML = `
      <h2 style="margin-top:0">Register / Claim Android Display</h2>
      <p class="muted">Scan the QR shown on the Android LED player, or enter its NMC display code.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
        <button type="button" class="primary" id="startQrScanBtn">Scan QR with camera</button>
        <button type="button" class="secondary" id="stopQrScanBtn" disabled>Stop scanner</button>
      </div>
      <video id="deviceQrVideo" playsinline muted style="display:none;width:100%;max-width:420px;border-radius:12px;background:#111"></video>
      <canvas id="deviceQrCanvas" hidden></canvas>
      <form id="manualDeviceCodeForm" style="display:grid;gap:10px;margin-top:14px">
        <label for="manualNmcCode">NMC display code</label>
        <input id="manualNmcCode" name="display_code" placeholder="NMC-XXXXXXXXXX" autocomplete="off" autocapitalize="characters" maxlength="14" required style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <label for="pairingCodeInput">Six-digit code shown on the Android display</label>
        <input id="pairingCodeInput" name="pairing_code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" autocomplete="one-time-code" required style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <label for="claimDisplayName">Display name (optional)</label>
        <input id="claimDisplayName" name="name" placeholder="e.g. Main Auditorium LED" autocomplete="off" style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <label for="claimDisplayLocation">Location (optional)</label>
        <input id="claimDisplayLocation" name="location_label" placeholder="e.g. NMAMIT Auditorium" autocomplete="off" style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <button type="submit" class="primary" id="claimManualCodeBtn">Pair display</button>
      </form>
      <p id="deviceRegistrationHelp" class="muted" role="status" aria-live="polite" style="margin-bottom:0"></p>`;
    const displayList = $("displayList");
    if (displayList?.parentElement) displayList.parentElement.insertBefore(panel, displayList);
    else dashboard.prepend(panel);
    const legacyForm = $("registerForm");
    if (legacyForm) legacyForm.classList.add("hidden");
    $("startQrScanBtn").addEventListener("click", startQrScanner);
    $("stopQrScanBtn").addEventListener("click", stopQrScanner);
    $("manualDeviceCodeForm").addEventListener("submit", async event => {
      event.preventDefault();
      const display_code = $("manualNmcCode").value.trim().toUpperCase();
      if (!/^NMC-[A-Z0-9]{10}$/.test(display_code)) {
        registrationMessage("Enter the full NMC code shown on the Android player (example: NMC-AC8527AD59).");
        return;
      }
      await claimDevice({ display_code, code: $("pairingCodeInput").value.trim(), name: $("claimDisplayName").value.trim(), location_label: $("claimDisplayLocation").value.trim() });
    });
  }
  let qrStream = null;
  let qrFrame = null;
  function registrationMessage(message) {
    const el = $("deviceRegistrationHelp");
    if (el) el.textContent = message;
    say(message);
  }
  function parseDeviceQr(rawValue) {
    const raw = String(rawValue || "").trim();
    if (/^NMC-[A-Z0-9]{10}$/i.test(raw)) return { display_code: raw.toUpperCase() };
    try {
      const url = new URL(raw, window.location.href);
      const display_code = (url.searchParams.get("claim") || url.searchParams.get("display_code") || url.searchParams.get("display") || "").toUpperCase();
      const code = (url.searchParams.get("code") || url.searchParams.get("claim_code") || "").trim();
      if (/^NMC-[A-Z0-9]{10}$/.test(display_code)) return { display_code, code };
    } catch (_) {}
    return null;
  }
  async function startQrScanner() {
    if (!navigator.mediaDevices?.getUserMedia) return registrationMessage("Camera unavailable here. Enter the NMC code manually.");
    if (!("BarcodeDetector" in window)) return registrationMessage("This browser lacks built-in QR scanning. Try Chrome on Android or enter the NMC code manually.");
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      const video = $("deviceQrVideo"); video.srcObject = qrStream; video.style.display = "block"; await video.play();
      $("startQrScanBtn").disabled = true; $("stopQrScanBtn").disabled = false;
      registrationMessage("Camera ready. Point it at the QR code on the Android player.");
      const canvas = $("deviceQrCanvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (!qrStream) return;
        if (video.videoWidth) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          try {
            const results = await detector.detect(canvas);
            if (results.length) {
              const parsed = parseDeviceQr(results[0].rawValue);
              if (parsed) {
                stopQrScanner(); $("manualNmcCode").value = parsed.display_code;
                if (parsed.code && $("pairingCodeInput")) $("pairingCodeInput").value = parsed.code;
                registrationMessage("QR recognized. Enter the six-digit code shown on the Android screen, then tap Pair display.");
                return;
              }
            }
          } catch (_) {}
        }
        qrFrame = requestAnimationFrame(scan);
      };
      qrFrame = requestAnimationFrame(scan);
    } catch (error) { stopQrScanner(); registrationMessage(`Could not start scanner: ${errorMessage(error)}. Enter the NMC code manually.`); }
  }
  function stopQrScanner() {
    if (qrFrame) cancelAnimationFrame(qrFrame); qrFrame = null;
    if (qrStream) qrStream.getTracks().forEach(track => track.stop()); qrStream = null;
    const video = $("deviceQrVideo");
    if (video) { video.pause(); video.srcObject = null; video.style.display = "none"; }
    if ($("startQrScanBtn")) $("startQrScanBtn").disabled = false;
    if ($("stopQrScanBtn")) $("stopQrScanBtn").disabled = true;
  }
  async function invokeRegistrationFunction(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let details = error.message || `${name} request failed.`;
      if (error.context && typeof error.context.clone === "function") {
        try { const response = await error.context.clone().json(); details = response.error || response.message || details; } catch (_) {}
      }
      throw new Error(details);
    }
    if (!data || data.ok !== true) throw new Error(data?.error || data?.message || `${name} did not confirm success.`);
    return data;
  }
  async function claimDevice({ display_code, code = "", name = "", location_label = "" }) {
    if (!sb) return;
    const button = $("claimManualCodeBtn");
    if (button) button.disabled = true;
    const pairingCode = String(code || "").trim();
    if (!/^\d{6}$/.test(pairingCode)) {
      registrationMessage("Enter the six-digit code currently shown on the Android display.");
      if (button) button.disabled = false;
      return;
    }
    registrationMessage(`Pairing ${display_code}…`);
    try {
      // The Android player creates the temporary pairing session. The admin
      // only redeems the code displayed by that device; do not create a second
      // code in the controller.
      const claimed = await invokeRegistrationFunction("claim-display", {
        display_code,
        qr_code: pairingCode,
        name: name || `Display ${display_code}`,
        location_label
      });
      registrationMessage(`${claimed.message || "Pairing accepted."} Refreshing display status…`);
      await loadDisplays();
      registrationMessage("Pairing request accepted. The Android player should authenticate and become ACTIVE shortly.");
    } catch (error) {
      const message = errorMessage(error, "Pairing failed.");
      registrationMessage(`Pairing failed: ${message}`);
      if (/retired/i.test(message)) {
        registrationMessage("This display identity is retired. Keep the database record; the Android player must generate a fresh registration identity.");
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return;

    const email = $("email").value.trim();
    const password = $("password").value;
    const button = $("loginForm").querySelector("button");

    button.disabled = true;
    say("Signing in…");

    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error("No authenticated session returned.");

      $("accountLabel").textContent = data.user.email || "Signed in";
      showDashboard(true);
      connected(true);
      await loadDisplays();
    } catch (error) {
      connected(false);
      say(`Sign-in failed: ${errorMessage(error)}`);
    } finally {
      button.disabled = false;
      $("password").value = "";
    }
  });

  $("refreshBtn").addEventListener("click", async () => {
    try {
      await loadDisplays();
    } catch (error) {
      connected(false);
      say(`Could not load displays: ${errorMessage(error)}`);
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try {
      if (sb) {
        const { error } = await sb.auth.signOut();
        if (error) throw error;
      }
      displays = [];
      selectedDisplay = null;
      latestPairing = null;
      showDashboard(false);
      connected(false);
      say("Signed out.");
    } catch (error) {
      say(`Sign-out failed: ${errorMessage(error)}`);
    }
  });

  $("closePairBtn").addEventListener("click", () => {
    $("pairPanel").classList.add("hidden");
    selectedDisplay = null;
  });

  $("copyBtn").addEventListener("click", async () => {
    if (!latestPairing) {
      say("Generate a pairing code first.");
      return;
    }

    const text =
      `Display code: ${latestPairing.display_code}\nPairing code: ${latestPairing.pairing_code}`;

    try {
      await navigator.clipboard.writeText(text);
      say("Pairing codes copied. Keep them private.");
    } catch (_) {
      say(text);
    }
  });

  function handleIncomingQrUrl() {
    const params = new URLSearchParams(window.location.search);
    const display_code = (params.get("claim") || params.get("display_code") || "").toUpperCase();
    const code = (params.get("code") || params.get("claim_code") || "").trim();
    if (!/^NMC-[A-Z0-9]{10}$/.test(display_code)) return;
    const apply = () => {
      ensureDeviceRegistrationUI();
      if ($("manualNmcCode")) $("manualNmcCode").value = display_code;
      if (code && $("pairingCodeInput")) $("pairingCodeInput").value = code;
      registrationMessage(code
        ? "Android QR recognized. Verify the six-digit code shown on the display, then tap Pair display."
        : "Android QR recognized. Enter the six-digit code shown on the display, then tap Pair display.");
    };
    if (sb && $("deviceRegistrationPanel")) apply();
    else window.addEventListener("nmamit-controller-ready", apply, { once: true });
  }

  async function start() {
    if (!validConfig || !window.supabase) {
      connected(false);
      showDashboard(false);
      say("Configuration or Supabase client is missing. Check controller/config.js and your network.");
      return;
    }

    sb = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    window.dispatchEvent(new Event("nmamit-controller-ready"));

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;

      if (data.session) {
        $("accountLabel").textContent = data.session.user.email || "Signed in";
        showDashboard(true);
        await loadDisplays();
      } else {
        showDashboard(false);
        connected(true, "READY");
        say("Sign in with your owner/admin account.");
      }
    } catch (error) {
      connected(false);
      say(`Startup error: ${errorMessage(error)}`);
    }
  }

  showDashboard(false);
  start();
})();