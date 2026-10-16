import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medibuddy.app',
  appName: 'MediBuddy',
  webDir: 'dist',

  android: {
    // Allow mixed content so Supabase API calls work
    allowMixedContent: false,
    // Custom URL scheme for OAuth deep links (Step 4)
    // AndroidManifest.xml will be patched separately
  },

  plugins: {
    SplashScreen: {
      // Hidden by the app as soon as the session has loaded (src/lib/startFlow.ts,
      // max ~2 s); no fixed delay.
      launchAutoHide: false,
      backgroundColor: '#ffffff',   // white, like the logo background
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    // Capacitor 8 built-in edge-to-edge handling (required on Android 15+).
    // 'css' passes real safe-area insets to env(safe-area-inset-*) and also
    // injects --safe-area-inset-* variables, used in index.css.
    SystemBars: {
      insetsHandling: 'css',
      // Follows the phone's light/dark setting until the app applies the
      // user's theme choice (ThemeContext).
      style: 'DEFAULT',
      initialViewportFitValueHint: 'cover',
    },
    StatusBar: {
      style: 'DEFAULT',             // set per theme at runtime (ThemeContext)
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_medibuddy', // white MediBuddy silhouette (res/drawable-*dpi)
      iconColor: '#0077CE',         // logo blue
      sound: 'beep.wav',
    },
  },
};

export default config;
