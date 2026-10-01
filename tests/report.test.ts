import { it, expect } from 'vitest';
import { buildCompanyInvestigationReport, type CompanyReportDependencies } from '../src/analysis/report.js';
const source={name:'Fixture',publisher:'Fixture',url:'https://example.test',retrievedAt:'2020-01-01',status:'primary' as const};
const siren='000000001';
function dependencies():CompanyReportDependencies{return {
  getCompany:async()=>({siren,nom_complet:'ENTREPRISE FICTIVE',etat_administratif:'A',dirigeants:[]}),
  buildGraph:async()=>({rootSiren:siren,nodes:[],edges:[],candidateEdges:[],linkedEntities:[],peopleCoverage:[],coverage:{peopleTotal:0,peopleExamined:0,peopleTruncated:false,maxCompaniesPerPerson:5},source,limitations:[]}),
  getBodacc:async()=>({siren,total:0,returned:0,records:[],source,coverage:'Réponse simulée'}),
  getInpiRecord:async()=>{throw Error('Accès non configuré');},
  getInpiAttachments:async()=>{throw Error('Accès non configuré');},
  searchAdlc:async()=>({query:'ENTREPRISE FICTIVE',matches:[],source,resourceUrl:source.url,limitations:[]})
};}
it('produit une synthèse partielle sans accès INPI et sans inventer de pièces',async()=>{
  const r=await buildCompanyInvestigationReport(siren,{},dependencies()) as any;
  expect(r.identity.siren).toBe(siren);
  expect(r.coverage.criticalDomainsComplete).toBe(false);
  expect(r.coverage.checks.find((c:any)=>c.id==='regulatory-sector').status).toBe('not_checked');
});
it('préserve les autres résultats en cas de panne d’une source',async()=>{
  const d=dependencies();d.searchAdlc=async()=>{throw Error('Panne simulée');};
  const r=await buildCompanyInvestigationReport(siren,{},d) as any;
  expect(r.identity.siren).toBe(siren);
  expect(r.coverage.checks.find((c:any)=>c.id==='adlc').status).toBe('partial');
});
