import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({ base: '/kohako/', build: { rollupOptions: { input: { index: resolve('index.html'), studio: resolve('studio.html'), live2d: resolve('live2d.html'), candidates: resolve('candidates.html') } } } })
