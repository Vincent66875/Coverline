import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves the built files from a sub-path, so asset URLs must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'build', emptyOutDir: true },
});
