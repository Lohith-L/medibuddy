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
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f172a',   // matches app dark bg
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',                // use 'dark' icons on light bg
      backgroundColor: '#0f172a',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#6366f1',         // indigo brand colour
      sound: 'beep.wav',
    },
  },
};

export default config;
