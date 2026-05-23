import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    open: true,
    watch: {
      ignored: ['**/public/assets/Cube World - Aug 2023/**', '**/dist/**'],
      usePolling: true,
      interval: 1000
    }
  },
  test: {
    environment: 'jsdom'
  }
});
