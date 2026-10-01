import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name:'osint-business-check',version:'1.0.0' });
const transport = new StdioClientTransport({ command:process.execPath,args:[fileURLToPath(new URL('./start.mjs',import.meta.url))], stderr:'pipe' });
try {
  await client.connect(transport);
  const {tools}=await client.listTools();
  if (tools.length < 15 || !tools.some(t=>t.name==='build_company_investigation_report')) throw Error('Inventaire incomplet');
  const bad = await client.callTool({name:'get_company_snapshot',arguments:{siren:'invalid'}}).catch(()=>({isError:true}));
  if (!bad.isError) throw Error('Validation de SIREN absente');
  console.log(`${tools.length} outils MCP découverts ; argument invalide refusé. Aucune donnée réelle recherchée.`);
} finally {await client.close();}
