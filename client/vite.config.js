import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },

  build: {
    // Let Vite/Rollup determine safe production chunk boundaries.
    // Do not manually split React, MUI, or Emotion yet.
  },
});

