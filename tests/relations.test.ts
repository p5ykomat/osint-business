import { it, expect } from 'vitest';
import { buildCompanyMandateGraph } from '../src/analysis/graph.js';
import { normalizeDocumentaryRelationshipPaths } from '../src/analysis/relationships.js';
import type { DocumentaryRelationshipPathInput, RelationshipEndpoint } from '../src/types.js';
const source={name:'Source fictive',publisher:'Test',url:'https://example.test',retrievedAt:'2020-01-01',status:'primary' as const};
const director={type_dirigeant:'personne physique',nom:'EXEMPLE',prenoms:'ALEX',qualite:'Gérant',date_de_naissance:'1985-02'};
const root={siren:'000000001',nom_complet:'SOCIETE ALPHA FICTIVE',dirigeants:[director]};
it('établit un chemin de deux mandats vers une SCI fictive',async()=>{
  const g=await buildCompanyMandateGraph(root.siren,{}, {
    getCompany:async()=>root,
    searchMandates:async()=>({person:{nom:'EXEMPLE'},companies:[{company:{siren:'000000002',nom_complet:'SCI BETA FICTIVE',nature_juridique:'6540'},matchingMandates:[director],matchConfidence:'high',matchBasis:['Identité fictive concordante']}],source,limitations:[]})
  });
  expect(g.linkedEntities).toHaveLength(1);
  expect(g.linkedEntities[0]?.connectionToAnchor.hopCount).toBe(2);
  expect(g.linkedEntities[0]?.kind).toBe('sci');
});
it('signale une recherche de mandats indisponible',async()=>{
  const g=await buildCompanyMandateGraph(root.siren,{}, {getCompany:async()=>root,searchMandates:async()=>{throw Error('Source simulée indisponible');}});
  expect(g.peopleCoverage[0]?.status).toBe('unavailable');
});
const a:RelationshipEndpoint={id:'company:000000001',type:'company',siren:'000000001',label:'ALPHA FICTIVE'};
const b:RelationshipEndpoint={id:'company:000000002',type:'company',siren:'000000002',label:'BETA FICTIVE'};
function addressPath():DocumentaryRelationshipPathInput{return {id:'fixture',target:b,priority:'medium',analyticalRelevance:'Piste fictive',steps:[{from:a,to:b,relation:'shared_address_context',exactMechanism:'Adresse professionnelle commune',verificationStatus:'verified',temporalStatus:'current',confidence:'low',evidence:[{level:'official_metadata',source:'Fixture',page:null,date:'2020-01-01'}],limitations:['Ne prouve aucun contrôle']}],whatItDoesNotProve:['Propriété']};}
it('interdit de transformer une adresse commune en lien établi',()=>{
  expect(normalizeDocumentaryRelationshipPaths([addressPath()],a)[0]?.status).toBe('invalid');
});
it('conserve comme candidat un lien non corroboré',()=>{
  const input=addressPath();input.steps[0]!.relation='professional_mandate';input.steps[0]!.verificationStatus='candidate';
  expect(normalizeDocumentaryRelationshipPaths([input],a)[0]?.status).toBe('candidate');
});
