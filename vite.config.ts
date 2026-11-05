import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/HexMarble/',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
