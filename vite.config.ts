import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/novel-app-prototype/',
  plugins: [react()],
})
