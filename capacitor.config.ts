import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reveal.partygames',
  appName: 'REVEAL',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // Origine WebView = même hostname que le site (déjà dans Turnstile), pas https://localhost.
    hostname: 'julie-lepine.github.io',
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
