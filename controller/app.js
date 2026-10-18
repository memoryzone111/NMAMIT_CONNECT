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
        <label for="claimDisplayName">Display name (optional)</label>
        <input id="claimDisplayName" name="name" placeholder="e.g. Main Auditorium LED" autocomplete="off" style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <label for="claimDisplayLocation">Location (optional)</label>
        <input id="claimDisplayLocation" name="location_label" placeholder="e.g. NMAMIT Auditorium" autocomplete="off" style="padding:12px;border-radius:9px;width:100%;box-sizing:border-box">
        <button type="submit" class="primary" id="claimManualCodeBtn">Find display &amp; generate pairing code</button>
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
      // An NMC code identifies an existing display; it is not an Android credential.
      // Find the existing record and use the established pairing-session flow.
      const existing = displays.find(item => String(item.display_code || "").toUpperCase() === display_code);
      if (!existing) {
        registrationMessage("This NMC code is not in the display list for the signed-in account. Refresh the list or register the display through the authorized setup flow first.");
        return;
      }
      if (["retired", "revoked"].includes(existing.lifecycle_status)) {
        registrationMessage(`This display is ${existing.lifecycle_status} and cannot be paired.`);
        return;
      }
      await createPairing(existing);
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
                if (parsed.code) await claimDevice({ ...parsed, name: $("claimDisplayName").value.trim(), location_label: $("claimDisplayLocation").value.trim() });
                else registrationMessage("QR recognized. Display code filled in. Press Find display & generate pairing code to continue.");
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
    if (!code.trim()) {
      registrationMessage(
        "A device code alone cannot activate a display. Scan the full, current QR shown on the Android player."
      );
      return;
    }

    if (!/^NMC-[A-Z0-9]{10}$/.test(display_code || "")) {
      registrationMessage("Invalid display code. Scan the QR shown on the Android player.");
      return;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      registrationMessage("The pairing code must contain six digits. Scan the latest QR shown on the Android player.");
      return;
    }

    if (button) button.disabled = true;
    registrationMessage(`Claiming ${display_code}…`);

    try {
      const data = await invokeRegistrationFunction("claim-display", {
        display_code,
        qr_code: code.trim(),
        name: name.trim() || `Display ${display_code}`,
        location_label: location_label.trim()
      });

      const message = data.message || "Display claim accepted.";
      registrationMessage(`${message} Refreshing displays…`);
      await loadDisplays();

      if ($("manualDeviceCodeForm")) $("manualDeviceCodeForm").reset();
      registrationMessage(`${message} Check the display list for its current status.`);
    } catch (error) {
      registrationMessage(`Could not claim display: ${errorMessage(error)}. Scan the latest QR and try again.`);
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
      if (code) {
        claimDevice({
          display_code,
          code,
          name: $("claimDisplayName")?.value.trim() || "",
          location_label: $("claimDisplayLocation")?.value.trim() || ""
        });
      } else {
        registrationMessage(
          "This QR contains only the device code, not a temporary pairing code. Update the Android player to show the full pairing QR."
        );
      }
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