import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@nexvas/plugin-animate',
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
