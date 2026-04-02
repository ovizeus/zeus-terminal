import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zeus.terminal',
  appName: 'Zeus Terminal',
  webDir: 'public',
  server: {
    url: 'https://zeus-terminal.com',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0f16',
      showSpinner: true,
      spinnerColor: '#f0c040',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#0a0f16',
    },
  },
};

export default config;
