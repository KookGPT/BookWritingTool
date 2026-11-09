import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Dev only: POST /__shot?name=x saves a canvas snapshot to test/out/shots/x.jpg, so Claude can look at full-size renders. */
const shots: Plugin = {
  name: 'shots', apply: 'serve',
  configureServer(s) {
    s.middlewares.use('/__shot', (req, res) => {
      const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '_'), parts: Buffer[] = []
      req.on('data', (c: Buffer) => parts.push(c))
      req.on('end', () => { mkdirSync('test/out/shots', { recursive: true }); writeFileSync(`test/out/shots/${name}.jpg`, Buffer.concat(parts)); res.end('ok') })
    })
  },
}

export default defineConfig({
  base: '/BookWritingTool/',
  plugins: [
    shots,
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['*.svg', '*.png'],
      manifest: {
        name: 'Book Writing Tool',
        short_name: 'Bookwright',
        start_url: '/BookWritingTool/',
        display: 'standalone',
        background_color: '#1b1b1f',
        theme_color: '#1b1b1f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
