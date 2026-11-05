import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/HexMarble/',
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
