import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/BookWritingTool/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Book Writing Tool',
        short_name: 'Bookwright',
        start_url: '/BookWritingTool/',
        display: 'standalone',
        background_color: '#1b1b1f',
        theme_color: '#1b1b1f',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
})
