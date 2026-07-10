import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load env from the monorepo root so VITE_SERVER_HOST / VITE_SERVER_PORT are available.
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), 'VITE_');

  const host = (env.VITE_SERVER_HOST || 'http://localhost').replace(/\/+$/, '');
  const port = env.VITE_SERVER_PORT || '3001';
  const TARGET = `${host}:${port}`;
  const WS_TARGET = TARGET.replace(/^http/, 'ws');

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': TARGET,
        '/ws': {
          target: WS_TARGET,
          ws: true,
        },
      },
    },
  };
})
