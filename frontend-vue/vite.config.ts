import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/analysis/',
  server: {
    port: 5174,
    proxy: {
      '/metrics': 'http://127.0.0.1:8000',
      '/jobs': 'http://127.0.0.1:8000',
      '/reports': 'http://127.0.0.1:8000'
    }
  }
})
