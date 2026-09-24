import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cisapp.partner',
  appName: 'COINS',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
