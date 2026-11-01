import {defineConfig} from 'vite';
const remoteApi = process.env.OCEAN_API_TARGET;
export default defineConfig({
  resolve: {dedupe: ['react', 'react-dom', 'lucide-react']},
  server: {
    port: 5173,
    fs: {allow: ['..']},
    proxy: {'/api': {
      target: remoteApi || 'http://127.0.0.1:8765',
      changeOrigin: Boolean(remoteApi),
      ...(remoteApi ? {configure(proxy) {
        proxy.on('proxyReq', request => request.setHeader('Origin', new URL(remoteApi).origin));
      }} : {}),
    }},
  },
  build: {outDir: 'dist'},
});
