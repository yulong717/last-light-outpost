import { defineConfig } from 'vite';

// base: './' 讓建置結果可以直接放到 GitHub Pages 或任何子路徑
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
