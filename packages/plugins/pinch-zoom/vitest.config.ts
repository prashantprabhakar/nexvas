import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@nexvas/plugin-pinch-zoom',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
