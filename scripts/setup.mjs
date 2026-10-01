import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { printBanner } from './banner.mjs';
printBanner();
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Installez Node.js 22.16 ou une version LTS plus récente.');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Lancez ce guide avec npm run setup.');
for (const args of [['ci'], ['run', 'build']]) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
mkdirSync('artifacts', { recursive: true });
const start = join(root, 'scripts', 'start.mjs');
const quote = s => JSON.stringify(s);
const toml = `[mcp_servers.osint_business]\ncommand = ${quote(process.execPath)}\nargs = [${quote(start)}]\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n\n[mcp_servers.data_gouv]\nurl = "https://mcp.data.gouv.fr/mcp"\n`;
writeFileSync('artifacts/codex-config.txt', toml);
writeFileSync('artifacts/claude-code-config.json', JSON.stringify({mcpServers:{osint_business:{type:'stdio',command:process.execPath,args:[start]}}},null,2));
console.log('\nInstallation terminée. Aucun compte externe ni abonnement créé.');
console.log('Codex : bloc prêt à copier dans artifacts/codex-config.txt.');
console.log('Claude Code : configuration dans artifacts/claude-code-config.json.');
console.log('Lisez docs/INSTALLATION.md pour connecter votre application.');
console.log('Diagnostic local : npm run doctor. Test MCP sans réseau : npm run smoke.');
