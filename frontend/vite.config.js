import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
// Keep this default aligned with local API .env and docker-compose defaults.
const apiPort = process.env.API_PORT || process.env.VITE_API_PORT || '3002'
const previewPort = process.env.VITE_PREVIEW_PORT || '4173'

export default defineConfig(({ mode }) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const env = loadEnv(mode, process.cwd(), '')
  const backendApiUrl = env.BACKEND_API_URL || env.REACT_APP_BACKEND_API_URL || env.VITE_BACKEND_API_URL || env.VITE_API_BASE_URL || '/api'
  const proxyCandidate = env.VITE_API_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET || ''
  const apiProxyTarget = /^https?:\/\//i.test(proxyCandidate) ? proxyCandidate : `http://127.0.0.1:${apiPort}`

  return {
    plugins: [react()],
    define: {
      'process.env.BACKEND_API_URL': JSON.stringify(backendApiUrl),
      'process.env.REACT_APP_BACKEND_API_URL': JSON.stringify(backendApiUrl),
    },
    server: {
      host: '0.0.0.0',
      port: Number(process.env.VITE_PORT || '5173'),
      fs: {
        allow: [path.resolve(__dirname, '..')],
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(previewPort),
    },
  }
})
