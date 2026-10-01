import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');
console.log('Node.js :', process.versions.node);
console.log('Serveur compilé :', existsSync('dist/src/index.js') ? 'oui' : 'non, lancez npm run setup');
for (const [label, vars] of [['INPI',['INPI_USERNAME','INPI_PASSWORD']],['Judilibre',['PISTE_CLIENT_ID','PISTE_CLIENT_SECRET']]]) {
  console.log(label, vars.every(v=>Boolean(process.env[v]?.trim())) ? ': variables présentes, accès distant non vérifié' : ': non configuré (facultatif)');
}
console.log('Aucune valeur de clé affichée. Aucune requête externe effectuée.');
