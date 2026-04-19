import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@nexvas/plugin-clipboard',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
