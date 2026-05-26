import { defineConfig } from 'vitest/config';

export default defineConfig({
  publicDir: false,
  assetsInclude: ['**/*.fbx', '**/*.gltf'],
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    open: true,
    watch: {
      ignored: ['**/public/**', '**/dist/**', '**/docs/**', '**/.mcpheadlessbrowser/**']
    }
  },
  test: {
    environment: 'jsdom'
  }
});
