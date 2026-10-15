# NMAMIT CONNECT — Digital Signage Starter

A portrait (9:16) Android signage player + mobile web remote controller.

## Included
- Android native player project (Kotlin), `minSdk 21` (Android 5.0+)
- Image/video playback, playlist repeat modes, play/pause, next/previous
- QR pairing screen, polling-based playlist sync, local media cache
- Mobile controller website with upload, playlist, playback controls
- Supabase SQL schema and setup guide
- Boot receiver (best effort; some device firmware requires enabling auto-start manually)

## Important status
This is a **starter project source package**, not a prebuilt APK and not a tested production deployment.
The APK must be built with Android Studio and tested on the exact LED device.
Supabase project credentials and schema setup are required before online sync works.
Do not put a Supabase `service_role` key in the Android app or website.

## Architecture
- `android-player/`: native Android application
- `controller/`: static web app, suitable for GitHub Pages
- `supabase/schema.sql`: database, storage bucket, row-level security policies
- `SETUP.md`: deployment and installation steps

## Recommended setup
1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Create a public `signage-media` storage bucket (only media intended for public display belongs here).
4. Copy the project URL and anon/publishable key into `controller/config.js` and `android-player/app/src/main/assets/config.json`.
5. Configure the display record and pair code using the SQL instructions in `SETUP.md`.
6. Host `controller/` on GitHub Pages using HTTPS.
7. Build and install the Android APK from Android Studio.

## Security notes
This starter uses a pairing code as a convenience, not enterprise-grade authentication. The SQL policies intentionally limit data access to the configured display ID but still require a security review before public/production use. Use a unique, high-entropy display token, restrict who can access the controller, and rotate credentials if the QR is exposed. Public media bucket contents are publicly retrievable by URL.
