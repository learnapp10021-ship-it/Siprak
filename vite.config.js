import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' agar hasil build bisa dihosting di subpath (mis. GitHub Pages)
export default defineConfig({ base: './', plugins: [react()] })
