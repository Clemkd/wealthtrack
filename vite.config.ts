import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/wealthtrack/',
  plugins: [react()],
  test: {
    // West of UTC, so that a test that confuses UTC and local dates cannot pass
    // just because the machine running it is on UTC (the CI is)
    env: { TZ: 'America/Los_Angeles' },
  },
});
