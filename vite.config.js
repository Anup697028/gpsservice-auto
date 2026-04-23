import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Keep this default aligned with local API .env and docker-compose defaults.
const apiPort = process.env.API_PORT || process.env.VITE_API_PORT || '3002'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
})
