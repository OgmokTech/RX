import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy keeps the API same-origin in development: cookies work and no CORS preflights
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't bust the browser cache for React/MUI,
        // and the chart library only downloads when someone opens Reports.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          return undefined;
        },
      },
    },
  },
});
