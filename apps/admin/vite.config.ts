import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

const config = defineConfig({
  envDir: '../..',
  resolve: { tsconfigPaths: true },
  server: {
    fs: { allow: ['../..'] },
    port: 3001,
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro({ preset: 'vercel' }), viteReact()],
})

export default config
