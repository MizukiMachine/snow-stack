import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    open: true,
    watch: {
      ignored: ['**/dist/**', '**/docs/**', '**/.mcpheadlessbrowser/**']
    }
  },
  test: {
    environment: 'jsdom'
  }
});
