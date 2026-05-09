#!/usr/bin/env node
// thoth — entry point shim.
// In dev: tsx-resolves the TS source. In production: loads the built dist/.
import('../src/index.ts').catch(() => import('../dist/index.js')).catch((err) => {
  console.error('Failed to start Thoth CLI:', err);
  process.exit(1);
});
