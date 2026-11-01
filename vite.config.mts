import { defineConfig } from 'vite';
export default defineConfig({ root: 'client', envDir: false, build: { outDir: '../dist', emptyOutDir: true }, server: { host: '127.0.0.1' } });
