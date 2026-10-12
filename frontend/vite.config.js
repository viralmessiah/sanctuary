import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://localhost:8000'
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: {
      // In dev the browser talks only to Vite; /api and /media are forwarded to Django,
      // so no CORS setup is needed and uploaded-file URLs stay relative.
      proxy: {
        '/api': backend,
        '/media': backend,
        '/ws': { target: backend, ws: true },
      },
    },
  }
})
