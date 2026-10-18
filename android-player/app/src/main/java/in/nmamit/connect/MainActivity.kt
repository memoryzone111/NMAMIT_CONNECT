package com.nmamit.connect

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.VideoView
import org.json.JSONArray
import org.json.JSONObject
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.UUID
import java.security.SecureRandom

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var root: FrameLayout
    private lateinit var pairingPanel: LinearLayout
    private lateinit var subtitleText: TextView
    private lateinit var statusText: TextView
    private lateinit var image: ImageView
    private lateinit var video: VideoView
    private lateinit var qr: ImageView
    private lateinit var deviceCodeText: TextView
    private lateinit var credentialStore: DisplayCredentialStore
    private lateinit var cfg: JSONObject
    private var playlist = JSONArray()
    private var index = 0
    private var paused = false
    private var loopMode = "playlist"
    private var lastSignature = ""
    private var currentFile: File? = null
    private var pairingRequestInProgress = false
    private var pairingRefreshScheduled = false
    private var identityRotationScheduled = false


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        cfg = JSONObject(assets.open("config.json").bufferedReader().use { it.readText() })
        credentialStore = DisplayCredentialStore(this)
        buildUi()
        // Always recover registration state on startup. The server decides
        // whether this display is still unpaired or has already been activated.
        showPairing()
        poll()
    }

    private fun buildUi() {
        val bg = Color.rgb(7, 10, 9)
        val panelColor = Color.rgb(18, 23, 21)
        val accent = Color.rgb(190, 242, 100)
        val muted = Color.rgb(166, 177, 169)

        root = FrameLayout(this).apply { setBackgroundColor(bg) }
        image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            visibility = View.GONE
            setBackgroundColor(Color.BLACK)
        }
        video = VideoView(this).apply { visibility = View.GONE }

        pairingPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(30), dp(30), dp(30), dp(28))
            background = rounded(panelColor, dp(26))
            elevation = dp(12).toFloat()
        }

        val brandRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val brandMark = TextView(this).apply {
            text = "N"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(bg)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            background = rounded(accent, dp(12))
        }
        brandRow.addView(brandMark, LinearLayout.LayoutParams(dp(48), dp(48)))
        val brandText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), 0, 0, 0)
        }
        brandText.addView(TextView(this).apply {
            text = "NMAMIT"
            textSize = 13f
            letterSpacing = 0.16f
            setTextColor(accent)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        })
        brandText.addView(TextView(this).apply {
            text = "CAMPUS DISPLAY NETWORK"
            textSize = 10f
            letterSpacing = 0.08f
            setTextColor(muted)
        })
        brandRow.addView(brandText, LinearLayout.LayoutParams(0, -2, 1f))
        pairingPanel.addView(brandRow, LinearLayout.LayoutParams(-1, -2))

        val title = TextView(this).apply {
            text = "NMAMIT CONNECT"
            textSize = 30f
            setTextColor(Color.WHITE)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            gravity = Gravity.CENTER
            letterSpacing = -0.025f
        }
        val titleParams = LinearLayout.LayoutParams(-1, -2)
        titleParams.topMargin = dp(30)
        pairingPanel.addView(title, titleParams)

        subtitleText = TextView(this).apply {
            text = "Bring this display online in a few simple steps."
            textSize = 14f
            setTextColor(muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(18))
        }
        pairingPanel.addView(subtitleText, LinearLayout.LayoutParams(-1, -2))

        val sectionLabel = TextView(this).apply {
            text = "CONNECT THIS DISPLAY"
            textSize = 11f
            letterSpacing = 0.14f
            setTextColor(accent)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }
        val sectionParams = LinearLayout.LayoutParams(-1, -2)
        sectionParams.bottomMargin = dp(12)
        pairingPanel.addView(sectionLabel, sectionParams)

        deviceCodeText = TextView(this).apply {
            text = getOrCreateInstallCode()
            textSize = 20f
            letterSpacing = 0.08f
            setTextColor(Color.WHITE)
            typeface = Typeface.create("monospace", Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(14), dp(12), dp(14))
            background = rounded(Color.rgb(28, 35, 31), dp(12), Color.rgb(54, 66, 58), dp(1))
        }
        val deviceCodeParams = LinearLayout.LayoutParams(-1, dp(56))
        deviceCodeParams.bottomMargin = dp(14)
        pairingPanel.addView(deviceCodeText, deviceCodeParams)

        statusText = TextView(this).apply {
            text = "●  READY TO CONNECT"
            textSize = 12f
            setTextColor(muted)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(18), dp(8), 0)
        }
        pairingPanel.addView(statusText, LinearLayout.LayoutParams(-1, -2))

        qr = ImageView(this).apply {
            adjustViewBounds = true
            visibility = View.GONE
        }
        pairingPanel.addView(qr, LinearLayout.LayoutParams(dp(240), dp(240)))

        root.addView(image, FrameLayout.LayoutParams(-1, -1))
        root.addView(video, FrameLayout.LayoutParams(-1, -1))
        val panelParams = FrameLayout.LayoutParams(
            minOf(dp(500), resources.displayMetrics.widthPixels - dp(36)),
            -2,
            Gravity.CENTER
        )
        panelParams.setMargins(dp(18), dp(18), dp(18), dp(18))
        root.addView(pairingPanel, panelParams)
        setContentView(root)
    }

    private fun showPairing() {
        image.visibility = View.GONE
        video.visibility = View.GONE
        pairingPanel.visibility = View.VISIBLE
        subtitleText.text = "Scan this QR code to continue setup in the web controller."
        statusText.visibility = View.VISIBLE
        deviceCodeText.text = getOrCreateInstallCode()
        qr.visibility = View.GONE
        startPairingSetup()
    }

    private fun getOrCreateInstallCode(): String {
        val prefs = getSharedPreferences("nmamit_connect_device", MODE_PRIVATE)
        val existing = prefs.getString("install_code", null)
        if (!existing.isNullOrBlank()) return existing
        val raw = UUID.randomUUID().toString().replace("-", "").uppercase()
        val code = "NMC-" + raw.take(10)
        prefs.edit().putString("install_code", code).apply()
        return code
    }

    private fun saveInstallCode(code: String) {
        getSharedPreferences("nmamit_connect_device", MODE_PRIVATE)
            .edit().putString("install_code", code).commit()
    }

    private fun generateInstallCode(): String {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val random = SecureRandom()
        return "NMC-" + (1..10).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
    }

    private fun generateCredential(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun getOrCreateCredential(): String {
        credentialStore.getCredential()?.takeIf { it.isNotBlank() }?.let {
            return it
        }
        return generateCredential().also { credentialStore.saveCredential(it) }
    }

    private fun scheduleIdentityRotation() {
        if (identityRotationScheduled) return
        identityRotationScheduled = true
        handler.postDelayed({
            identityRotationScheduled = false
            rotateIdentityIfUnpaired()
        }, 3 * 60 * 1000L)
    }

    private fun rotateIdentityIfUnpaired() {
        if (pairingRequestInProgress) {
            handler.postDelayed({ rotateIdentityIfUnpaired() }, 15000)
            return
        }

        pairingRequestInProgress = true
        executor.execute {
            val base = cfg.optString("supabaseUrl").trimEnd('/')
            val key = cfg.optString("supabaseAnonKey")
            val oldCode = getOrCreateInstallCode()
            val oldCredential = credentialStore.getCredential()

            try {
                if (oldCredential.isNullOrBlank()) {
                    handler.post {
                        pairingRequestInProgress = false
                        showPairing()
                    }
                    return@execute
                }

                val api = SupabaseDisplayApi(base, key)
                val current = api.registerDisplay(
                    oldCode,
                    oldCredential,
                    packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0",
                    android.os.Build.VERSION.SDK_INT
                )
                val lifecycle = current.optString("lifecycle_status")

                // Never rotate a paired display's identity.
                if (lifecycle == "active") {
                    handler.post {
                        pairingRequestInProgress = false
                        qr.visibility = View.GONE
                        statusText.text = "●  DISPLAY ACTIVATED"
                        subtitleText.text = "This display is active. Its identity will remain unchanged."
                    }
                    return@execute
                }

                val newCode = generateInstallCode()
                val newCredential = generateCredential()
                val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
                val apiLevel = android.os.Build.VERSION.SDK_INT

                val result = if (lifecycle == "registered") {
                    api.rotateDisplayRegistration(
                        oldCode, oldCredential, newCode, newCredential, version, apiLevel
                    )
                } else if (lifecycle == "retired") {
                    // A retired identity cannot be rotated. Start a fresh registration.
                    api.registerDisplay(newCode, newCredential, version, apiLevel)
                } else {
                    throw Exception("Unexpected display status: $lifecycle")
                }

                if (!result.optBoolean("ok") || result.optString("display_id").isBlank()) {
                    throw Exception(result.optString("error", "Identity rotation was not confirmed"))
                }

                // Save the replacement identity only after the server confirms it.
                saveInstallCode(newCode)
                credentialStore.saveCredential(newCredential)
                credentialStore.saveDisplayId(result.getString("display_id"))

                handler.post {
                    deviceCodeText.text = newCode
                    subtitleText.text = "New registration created. Scan the refreshed QR code."
                    requestPairingQrOnWorker(api, newCode, newCredential)
                }
            } catch (e: Exception) {
                // A claim may have completed just before the rotation request.
                // Recheck server state before deciding whether to retry.
                try {
                    val api = SupabaseDisplayApi(base, key)
                    val check = api.registerDisplay(
                        oldCode,
                        oldCredential ?: return@execute,
                        packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0",
                        android.os.Build.VERSION.SDK_INT
                    )
                    if (check.optString("lifecycle_status") == "active") {
                        handler.post {
                            pairingRequestInProgress = false
                            qr.visibility = View.GONE
                            statusText.text = "●  DISPLAY ACTIVATED"
                            subtitleText.text = "This display is active. Its identity will remain unchanged."
                        }
                        return@execute
                    }
                } catch (_: Exception) {
                    // The next retry will recover if the network is temporarily unavailable.
                }

                handler.post {
                    pairingRequestInProgress = false
                    statusText.text = "●  IDENTITY ROTATION RETRYING"
                    handler.postDelayed({ rotateIdentityIfUnpaired() }, 15000)
                }
            }
        }
    }

    private fun startPairingSetup() {
        if (pairingRequestInProgress) return
        pairingRequestInProgress = true
        statusText.text = "●  REGISTERING DISPLAY…"

        executor.execute {
            try {
                val base = cfg.optString("supabaseUrl").trimEnd('/')
                val key = cfg.optString("supabaseAnonKey")
                if (!base.startsWith("https://") || key.isBlank() || key.contains("YOUR_")) {
                    throw Exception("Configure the Supabase URL and publishable key")
                }

                val displayCode = getOrCreateInstallCode()
                val credential = getOrCreateCredential()
                val api = SupabaseDisplayApi(base, key)

                val registration = api.registerDisplay(
                    displayCode,
                    credential,
                    packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0",
                    android.os.Build.VERSION.SDK_INT
                )

                val displayId = registration.optString("display_id")
                if (registration.optBoolean("ok") != true || displayId.isBlank()) {
                    throw Exception(registration.optString("error", "Display registration was not confirmed"))
                }
                credentialStore.saveDisplayId(displayId)

                requestPairingQrOnWorker(api, displayCode, credential)
            } catch (e: Exception) {
                handler.post {
                    pairingRequestInProgress = false
                    pairingPanel.visibility = View.VISIBLE
                    statusText.visibility = View.VISIBLE
                    statusText.text = "●  SETUP FAILED · RETRYING"
                    subtitleText.text = e.message ?: "Could not register this display. Check the network and retry."
                    qr.visibility = View.GONE
                    handler.postDelayed({ startPairingSetup() }, 10000)
                }
            }
        }
    }

    private fun requestPairingQrOnWorker(
        api: SupabaseDisplayApi,
        displayCode: String,
        credential: String
    ) {
        val qrCode = SecureRandom().nextInt(1_000_000).toString().padStart(6, '0')
        val result = api.rotateDisplayQr(displayCode, credential, qrCode)

        handler.post {
            pairingRequestInProgress = false

            if (result.optBoolean("active")) {
                pairingRefreshScheduled = false
                qr.visibility = View.GONE
                statusText.text = "●  DISPLAY ACTIVATED"
                subtitleText.text = "This display is active. Waiting for content…"
                return@post
            }

            if (!result.optBoolean("ok")) {
                statusText.text = "●  QR REFRESH FAILED"
                subtitleText.text = result.optString("error", "Please retry setup.")
                handler.postDelayed({ startPairingSetup() }, 5000)
                return@post
            }

            renderControllerQr(qrCode)
            statusText.text = "●  WAITING FOR WEB ACTIVATION"
            subtitleText.text = "Scan this QR in the web controller. The code refreshes automatically."
            scheduleIdentityRotation()

            if (!pairingRefreshScheduled) {
                pairingRefreshScheduled = true
                handler.postDelayed({
                    pairingRefreshScheduled = false
                    refreshPairingQr()
                }, 45000)
            }
        }
    }

    private fun refreshPairingQr() {
        if (pairingRequestInProgress) return
        pairingRequestInProgress = true

        executor.execute {
            try {
                val base = cfg.optString("supabaseUrl").trimEnd('/')
                val key = cfg.optString("supabaseAnonKey")
                val credential = credentialStore.getCredential()
                    ?: throw Exception("Device credential is missing")
                val api = SupabaseDisplayApi(base, key)
                requestPairingQrOnWorker(api, getOrCreateInstallCode(), credential)
            } catch (e: Exception) {
                handler.post {
                    pairingRequestInProgress = false
                    statusText.text = "●  QR REFRESH FAILED · RETRYING"
                    handler.postDelayed({ refreshPairingQr() }, 5000)
                }
            }
        }
    }

    private fun renderControllerQr(qrCode: String) {
        try {
            val controller = cfg.optString("controllerUrl").trim()
            if (!controller.startsWith("https://")) {
                statusText.text = "●  CONFIGURE CONTROLLER URL"
                qr.visibility = View.GONE
                return
            }

            val separator = if (controller.contains("?")) "&" else "?"
            val payload = controller + separator +
                "claim=" + java.net.URLEncoder.encode(getOrCreateInstallCode(), "UTF-8") +
                "&code=" + java.net.URLEncoder.encode(qrCode, "UTF-8")

            val size = dp(240)
            val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, size, size)
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
            for (x in 0 until size) {
                for (y in 0 until size) {
                    bitmap.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
                }
            }
            qr.setImageBitmap(bitmap)
            qr.visibility = View.VISIBLE
        } catch (_: Exception) {
            statusText.text = "●  UNABLE TO GENERATE QR"
            qr.visibility = View.GONE
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Int, strokeColor: Int? = null, strokeWidth: Int = 0) =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius.toFloat()
            if (strokeColor != null && strokeWidth > 0) setStroke(strokeWidth, strokeColor)
        }

    private fun poll() {
        executor.execute {
            try {
                val base = cfg.optString("supabaseUrl").trimEnd('/')
                val key = cfg.optString("supabaseAnonKey")
                if (!base.startsWith("https://") || key.contains("YOUR_")) throw Exception("Configure Supabase")
                val credential = credentialStore.getCredential()
                    ?: throw Exception("Display is not paired")
                val id = credentialStore.getDisplayId()
                    ?: throw Exception("Display ID is missing")
                val auth = SupabaseDisplayApi(base, key).authenticate(credential)
                val display = auth.optJSONObject("display")
                    ?: throw Exception("Display details missing")
                if (display.optString("id") != id) {
                    throw Exception("Display identity mismatch")
                }
                val rows = getJson("$base/rest/v1/playlist_items?display_id=eq.${enc(id)}&select=*&order=position.asc,created_at.asc", key)
                val sig = rows.toString() + display.toString()
                handler.post {
                    if (display.optString("lifecycle_status") != "active") {
                        pairingPanel.visibility = View.VISIBLE
                        subtitleText.text = "This display needs activation in the controller."
                        image.visibility = View.GONE
                        video.visibility = View.GONE
                        statusText.visibility = View.VISIBLE
                        statusText.text = "Display is not active."
                        return@post
                    }
                    val desiredState = display.optString("desired_state", "playing")
                    if (desiredState != "playing") {
                        pairingPanel.visibility = View.VISIBLE
                        subtitleText.text = "Display status from the controller"
                        statusText.visibility = View.VISIBLE
                        image.visibility = View.GONE
                        video.visibility = View.GONE
                        statusText.visibility = View.VISIBLE
                        statusText.text = when (desiredState) {
                            "sleeping" -> "Display sleeping"
                            "frozen" -> "Display frozen by controller"
                            "emergency" -> "Emergency notice requested"
                            "maintenance" -> "Display in maintenance"
                            else -> "Display state: $desiredState"
                        }
                        return@post
                    }
                    if (sig != lastSignature) {
                        lastSignature = sig; playlist = rows
                        loopMode = "playlist"
                        paused = false
                        if (playlist.length() > 0) playIndex(index)
                        else {
                            pairingPanel.visibility = View.VISIBLE
                            subtitleText.text = "Your display is paired and ready for content."
                            statusText.text = "●  WAITING FOR MEDIA"
                        }
                    } else if (paused && video.isPlaying) video.pause()
                    else if (!paused && !video.isPlaying && video.visibility == View.VISIBLE) video.start()
                }
            } catch (e: Exception) {
                handler.post {
                    if (credentialStore.getCredential().isNullOrBlank()) {
                        showPairing()
                    } else if (playlist.length() == 0) {
                        pairingPanel.visibility = View.VISIBLE
                        subtitleText.text = "We will reconnect automatically when the network is available."
                        statusText.visibility = View.VISIBLE
                        statusText.text = "●  OFFLINE · RETRYING SYNC"
                    }
                }
            }
        }
        handler.postDelayed({ poll() }, 6000)
    }

    private fun playIndex(i: Int) {
        if (playlist.length() == 0) return
        index = when {
            i < 0 -> if (loopMode == "playlist") playlist.length()-1 else 0
            i >= playlist.length() -> if (loopMode == "playlist") 0 else playlist.length()-1
            else -> i
        }
        val item = playlist.optJSONObject(index) ?: return
        val url = item.optString("media_url")
        val type = item.optString("media_type")
        pairingPanel.visibility = View.GONE
        statusText.visibility = View.GONE; qr.visibility = View.GONE
        executor.execute {
            try {
                val file = cachedFile(url)
                handler.post {
                    currentFile = file
                    if (type == "video" || url.substringBefore('?').lowercase().endsWith(".mp4") ||
                        url.substringBefore('?').lowercase().endsWith(".webm")) {
                        image.visibility = View.GONE; video.visibility = View.VISIBLE
                        video.setVideoPath(file.absolutePath)
                        video.setOnPreparedListener { mp ->
                            mp.isLooping = loopMode == "one"
                            if (paused) mp.pause() else mp.start()
                        }
                        video.setOnCompletionListener {
                            if (loopMode != "one") playIndex(index + 1)
                        }
                    } else {
                        video.stopPlayback(); video.visibility = View.GONE; image.visibility = View.VISIBLE
                        val bmp = android.graphics.BitmapFactory.decodeFile(file.absolutePath)
                        image.setImageBitmap(bmp)
                        if (!paused) handler.postDelayed({ if (loopMode != "one") playIndex(index + 1) }, item.optInt("duration_seconds",10).coerceIn(1,3600)*1000L)
                    }
                }
            } catch (_: Exception) { handler.post { statusText.visibility = View.VISIBLE; statusText.text = "Media unavailable · retrying" } }
        }
    }

    private fun cachedFile(mediaUrl: String): File {
        val name = mediaUrl.hashCode().toString() + "_" + mediaUrl.substringBefore('?').substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
        val file = File(cacheDir, name)
        if (file.exists() && file.length() > 0) return file
        val connection = URL(mediaUrl).openConnection() as HttpURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 30000
        connection.setRequestProperty("User-Agent", "NMAMIT-CONNECT/1.0")
        connection.inputStream.use { input -> FileOutputStream(file).use { output -> input.copyTo(output) } }
        connection.disconnect()
        return file
    }

    private fun getJson(path: String, key: String): JSONArray {
        val conn = URL(path).openConnection() as HttpURLConnection
        conn.connectTimeout = 12000; conn.readTimeout = 12000
        conn.setRequestProperty("apikey", key)
        conn.setRequestProperty("Authorization", "Bearer $key")
        conn.setRequestProperty("Accept", "application/json")
        val text = conn.inputStream.bufferedReader().use { it.readText() }
        conn.disconnect()
        return JSONArray(text)
    }
    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); executor.shutdownNow(); super.onDestroy() }
}
