import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: '/jiaming_lake_2026/',
  // MapLibre 的 worker 是 ES module，會再匯入共用模組
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        // 遊記首頁與山屋時光計時頁都要納入建置
        main: resolve(root, 'index.html'),
        hutTime: resolve(root, 'hut-time/index.html'),
      },
    },
  },
})
