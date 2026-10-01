#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
// Keep downloads inside the installation, regardless of the client's working directory.
process.chdir(root);
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
if (!existsSync(resolve(root, 'dist/src/index.js'))) {
  console.error('OSINT Business : installation incomplète. Lancez npm run setup dans le dossier du projet.');
  process.exit(1);
}
await import('../dist/src/index.js');
