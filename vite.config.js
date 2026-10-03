import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // se registra en main.jsx para chequear updates seguido
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Terrible Poker',
        short_name: 'Terrible Poker',
        theme_color: '#0b3d2e',
        background_color: '#0b3d2e',
        display: 'standalone',
        orientation: 'portrait',
        icons: []
      }
    })
  ],
  server: { host: true }
})
