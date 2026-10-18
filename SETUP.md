# NMAMIT CONNECT setup guide

## 1. Create the Supabase backend
1. Create a project at https://supabase.com.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Storage, create a bucket named `signage-media`. For this starter, set it to public because the older Android player can fetch direct media URLs without expiring signed URLs. Upload only content approved for public display.
4. Copy the Project URL and anon/publishable key from Project Settings → API.
5. Configure the URL/key in both config files.

## 2. Configure a display
Run this SQL in Supabase SQL Editor after schema.sql. Replace the sample ID/token before use.

```sql
insert into public.displays (id, name, pair_code, controller_token, is_active)
values (
  'nmamit-led-01',
  'NMAMIT LED 01',
  'PAIR-CHANGE-ME',
  'CHANGE-THIS-TO-A-LONG-RANDOM-SECRET',
  true
);
```

Then add playlist items through the controller. Pairing values are shown in the Android app QR and must match the configured display. Treat the controller token as a secret.

## 3. Configure the web controller
Edit `controller/config.js`:
- `SUPABASE_URL`: your project URL
- `SUPABASE_ANON_KEY`: your anon/publishable key
- `DISPLAY_ID`: display row ID
- `CONTROLLER_TOKEN`: same token configured for that display

The included controller is a lightweight starter. For a production campus deployment, move privileged operations behind Supabase Edge Functions and use proper user authentication instead of shipping a shared controller token in static JavaScript.

## 4. Host controller on GitHub Pages
1. Create a GitHub repository and upload the contents of `controller/`.
2. In repository Settings → Pages, choose deploy from branch and select `main` / root.
3. Open the HTTPS GitHub Pages URL on your phone.
4. Keep the repository public only if you're comfortable exposing the frontend source. Never put service-role keys in it.

## 5. Build the Android APK
1. Install Android Studio.
2. Open the `android-player/` folder as a project.
3. Allow Gradle sync to complete. The build uses a compatible Android Gradle Plugin and Java 8 language settings; newer Android Studio may prompt to install the required SDK/build tools.
4. Select Build → Build Bundle(s) / APK(s) → Build APK(s).
5. APK output is normally under `android-player/app/build/outputs/apk/debug/app-debug.apk`.
6. Copy the APK to the LED Android device and install it. Enable “Install unknown apps” for the file manager/browser if required.
7. Set the app to launch at boot using the device's Auto Start / Launcher settings if the receiver is blocked by firmware.

## 6. Ethernet and screen configuration
- Connect Ethernet and confirm the device has internet access.
- Set the LED/player orientation to portrait if the device/launcher exposes that setting.
- Set display sleep to Never, disable screensaver, and enable kiosk/lock-task mode if supported.
- Some Android TV boxes do not permit third-party apps to be the default launcher. Use the manufacturer’s auto-start option where available.

## 7. Expected behavior and limitations
- The player polls the backend every few seconds; changes are not instant.
- Media downloaded once is cached in app-private storage. First playback requires network access.
- Video codec support depends on the hardware decoder and Android firmware.
- Android 5–7 devices may have old TLS/certificate stores. Keep firmware updated where possible.
- The starter’s QR contains a controller URL and pairing details. Do not photograph/share it publicly.
- A QR displayed by an app cannot automatically grant OS-level permissions; setup is a one-time manual process.
