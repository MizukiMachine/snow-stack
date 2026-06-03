import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.snowstack.app',
  appName: 'Snow Stack',
  webDir: 'dist',
  server: {
    // Android はデフォルトで https://localhost から配信する。
    // 絶対パス(/assets/...)が正しく解決される。
    androidScheme: 'https'
  }
};

export default config;
