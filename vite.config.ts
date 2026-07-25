import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('recharts')) return 'charts';
          if (id.includes('react')) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 4173,
    host: true
  }
});
