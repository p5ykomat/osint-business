import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// Inspect only the exact staged publication, never local secrets or generated reports.
const paths=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACMR','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const errors=[];
for(const p of paths){
  if(/(^|\/)(artifacts|output|reports|private|tmp|node_modules|dist|\.codex|\.claude)(\/|$)/.test(p)||(/(^|\/)\.env/.test(p)&&p!=='.env.example')||/\.(pdf|png|jpe?g|xlsx|sqlite|pem|key)$/i.test(p))errors.push(p+': fichier privé ou généré');
  const s=execFileSync('git',['show',':'+p],{encoding:'utf8'});
  if(/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/.test(s))errors.push(p+': secret possible');
  if(/[A-Z]:[\\/](?:Users|Codex)[\\/]|\/Users\/|\/home\/[a-z][^ /]+\//i.test(s))errors.push(p+': chemin propre à une machine');
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`${paths.length} fichiers indexés contrôlés. Revue humaine du contenu et de l'historique toujours nécessaire.`);
