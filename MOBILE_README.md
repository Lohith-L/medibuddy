# MediBuddy — Android Mobile App Guide

> This section covers everything you need to build, run, and release the Android app.
> The web app (`npm run dev`, deployed to Vercel) continues to work exactly as before.

---

## What Was Added

| Feature | How it works |
|---|---|
| **Capacitor** | Wraps the React/Vite SPA in a native Android WebView |
| **Same Supabase project** | App ID `com.medibuddy.app`, same URL + anon key as the website |
| **Auth on mobile** | CapacitorPreferences replaces localStorage for session storage |
| **Google OAuth deep link** | `com.medibuddy.app://login-callback` intercepts the redirect |
| **Realtime sync** | `medicines` + `reminder_events` tables subscribe to postgres_changes |
| **Native notifications** | `@capacitor/local-notifications` schedules daily medicine alarms |
| **FCM push notifications** | `@capacitor/push-notifications` + `send-push-notification` edge fn |
| **Mobile polish** | Status bar, splash screen (2s dark), back button, safe-area CSS |
| **App icon & splash** | Generated from `resources/icon.png` at all Android densities |

---

## npm Scripts

```bash
npm run dev          # Run web dev server (unchanged)
npm run build        # Build web only
npm run build:mobile # Build web + sync to Android (run before opening Android Studio)
npm run android      # Open Android Studio
npm run cap:sync     # Sync web assets to Android without rebuilding
```

---

## Build & Run on Your Phone (USB Debugging)

### Prerequisites
- **Android Studio** (latest stable) — https://developer.android.com/studio
- **Android SDK** API 22+ (installed via Android Studio SDK Manager)
- **JDK 17** (bundled with Android Studio)
- USB debugging enabled on your phone (Developer Options → USB Debugging)

### Steps

```bash
# 1. Build the web app and sync it into Android
npm run build:mobile

# 2. Open Android Studio
npm run android
```

In Android Studio:
1. Wait for Gradle sync to finish (~2 min first time)
2. Select your phone from the device dropdown
3. Click ▶ **Run** (or `Shift+F10`)
4. The app installs and launches on your phone automatically

---

## Create a Release APK / AAB

### Debug APK (for testing, no signing needed)
```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK / AAB (for Google Play)

1. **Create a keystore** (do this once, keep it safe):
   ```bash
   keytool -genkey -v -keystore medibuddy-release.keystore \
     -alias medibuddy -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Add signing config** to `android/app/build.gradle`:
   ```gradle
   android {
     signingConfigs {
       release {
         storeFile file("medibuddy-release.keystore")
         storePassword "YOUR_STORE_PASSWORD"
         keyAlias "medibuddy"
         keyPassword "YOUR_KEY_PASSWORD"
       }
     }
     buildTypes {
       release {
         signingConfig signingConfigs.release
       }
     }
   }
   ```

3. **Build release AAB** (recommended for Play Store):
   ```bash
   cd android
   ./gradlew bundleRelease
   # Output: android/app/build/outputs/bundle/release/app-release.aab
   ```

4. **Build release APK** (for direct install):
   ```bash
   ./gradlew assembleRelease
   # Output: android/app/build/outputs/apk/release/app-release.apk
   ```

> ⚠️ Never commit your keystore or passwords to git. Add to `.gitignore`.

---

## Manual Steps in Supabase Dashboard

### Required (do these now)

#### 1. Add OAuth Redirect URL
**Auth → URL Configuration → Redirect URLs** — add:
```
com.medibuddy.app://login-callback
```
This allows Google OAuth to redirect back to the app.

#### 2. Enable Realtime on tables
**Database → Replication → Tables** — toggle ON:
- `medicines`
- `reminder_events`
- `medicine_logs`

#### 3. Apply device_tokens migration (for FCM push)
Open **SQL Editor** and run the contents of:
```
supabase/migrations/20261011000000_device_tokens.sql
```

### Required for FCM Push (after Firebase setup)

#### 4. Add FCM_SERVER_KEY secret
**Edge Functions → Secrets** — add:
```
FCM_SERVER_KEY = <your Firebase Server Key>
```

#### 5. Deploy the new edge function
```bash
npx supabase functions deploy send-push-notification
```

---

## Firebase Setup (for FCM Push Notifications)

1. Go to https://console.firebase.google.com → **New Project**
2. Add an **Android app** with package name: `com.medibuddy.app`
3. Download `google-services.json`
4. Place it at: `android/app/google-services.json`
5. In Android Studio: Gradle sync will detect it automatically
6. Copy your **Server Key** from Firebase Console → Project Settings → Cloud Messaging
7. Add it as `FCM_SERVER_KEY` in Supabase Edge Function secrets (step 4 above)

---

## Notes on Existing Website Behaviour

- **Nothing changed** for the web. `npm run dev` and Vercel deploy work identically.
- `HashRouter` (URLs like `/#/dashboard`) is used instead of `BrowserRouter`. Vercel's `rewrites` config (`/(.*) → /index.html`) still handles this correctly.
- The Supabase client automatically falls back to `localStorage` on web and `CapacitorPreferences` on mobile.
- All notification and Capacitor hooks guard with `Capacitor.isNativePlatform()` — they are no-ops on web.

---

## Architecture Summary

```
medbuddy-your-health-companion-main/
├── src/
│   ├── hooks/
│   │   ├── useDeepLink.ts          # OAuth deep link handler (native only)
│   │   ├── useMobilePolish.ts      # Status bar, splash, back button
│   │   ├── useMedicineNotifications.ts  # Local notification scheduler
│   │   ├── usePushNotifications.ts # FCM registration + token storage
│   │   └── useRealtimeTable.ts     # Generic Supabase Realtime hook
│   ├── lib/
│   │   └── capacitorStorage.ts     # CapacitorPreferences storage adapter
│   └── integrations/supabase/
│       └── client.ts               # Uses platform-aware storage
├── android/                        # Native Android project (Capacitor)
├── resources/
│   └── icon.png                    # Source icon (1024×1024)
├── supabase/
│   ├── functions/
│   │   └── send-push-notification/ # FCM push edge function
│   └── migrations/
│       └── 20261011000000_device_tokens.sql  # device_tokens table
└── capacitor.config.ts             # App ID: com.medibuddy.app
```
