import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reveal.partygames',
  appName: 'REVEAL',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    // Même origine https://localhost que Android — Turnstile Cloudflare (hostnames localhost).
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#0A0F1C',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
