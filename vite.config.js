import { defineConfig } from 'vite'

export default defineConfig({
  base: '/jiaming_lake_2026/',
  // MapLibre 的 worker 是 ES module，會再匯入共用模組
  worker: { format: 'es' },
})
