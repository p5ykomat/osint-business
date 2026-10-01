import { describe, it, expect } from 'vitest';
import { assertSiren, normalizeText, givenNamesMatch } from '../src/lib/normalize.js';
import { assessPersonMatch } from '../src/connectors/recherche-entreprises.js';
import { resolveCompanyIdentity } from '../src/analysis/identity.js';
import { routeRegulatoryChecks } from '../src/analysis/regulatory-router.js';
import { assessCompanyOperatingStatus } from '../src/analysis/company-status.js';
import { buildEconomicFootprint } from '../src/analysis/economic-footprint.js';
import { sanitizeInpiPublicData, safeInpiOutputDirectory, assertInpiPdf, assertInpiDocumentId } from '../src/connectors/inpi.js';
import { groupDvfRows } from '../src/connectors/dvf.js';
import { reconcileObservations } from '../src/analysis/reconcile.js';

// Entirely synthetic records; no network requests and no real inquiry material.
const company = {siren:'000000001',nom_complet:'EXEMPLE ALPHA',etat_administratif:'A',dirigeants:[]};
describe('identité et homonymes',()=>{
  it('normalise les accents et valide le format du SIREN',()=>{
    expect(normalizeText(' Société École ')).toBe('SOCIETE ECOLE');
    expect(assertSiren('000 000 001')).toBe('000000001');
    expect(()=>assertSiren('abc')).toThrow();
  });
  it('ne lie pas un troisième prénom au prénom principal',()=>{
    expect(givenNamesMatch('Alex','ALEX CAMILLE')).toBe(true);
    expect(givenNamesMatch('Alex','CAMILLE ALEX')).toBe(false);
  });
  it('rejette un homonyme dont le mois de naissance diffère',()=>{
    const director={type_dirigeant:'personne physique',nom:'EXEMPLE',prenoms:'ALEX',date_de_naissance:'1985-02'};
    expect(assessPersonMatch({nom:'Exemple',prenoms:'Alex',dateNaissance:'1985-03'},director).matches).toBe(false);
    expect(assessPersonMatch({nom:'Exemple',prenoms:'Alex',dateNaissance:'1985-02'},director).confidence).toBe('high');
  });
  it('résout un identifiant exact et laisse les noms ambigus',async()=>{
    const search=async()=>({results:[company,{...company,siren:'000000002'}],total_results:2,page:1,per_page:10,total_pages:1});
    expect((await resolveCompanyIdentity('000000001',{},10,search)).status).toBe('resolved');
    expect((await resolveCompanyIdentity('EXEMPLE ALPHA',{},10,search)).status).toBe('ambiguous');
  });
});
describe('sources, limites et confidentialité',()=>{
  it('un contrôle proposé ne devient jamais un contrôle exécuté',()=>{
    const route=routeRegulatoryChecks({...company,activite_principale:'64.19Z'});
    expect(route.selectedRoutes.map(r=>r.id)).toContain('finance-authorizations');
    expect(route.selectedRoutes.every(r=>r.executionStatus==='routed_not_checked'&&!r.supportsNegativeConclusion)).toBe(true);
  });
  it('une cessation officielle prime sur une synthèse active',()=>{
    expect(assessCompanyOperatingStatus(company,{detailCessationEntreprise:{dateCessationTotaleActivite:'2020-01-01'}}).status).toBe('ceased');
  });
  it('distingue un désaccord de couverture',()=>{
    expect(reconcileObservations([{field:'documents.actCount',value:0,source:'A'},{field:'documents.actCount',value:2,source:'B'}])[0]?.kind).toBe('coverage_mismatch');
  });
  it('retire les secrets et masque les coordonnées personnelles',()=>{
    const value=sanitizeInpiPublicData({password:'synthetic',token:'synthetic',personnePhysique:{email:'person@example.test',dateDeNaissance:'1985-02-03',adresse:{voie:'VOIE FICTIVE'}}}) as any;
    expect(value.password).toBeUndefined();expect(value.token).toBeUndefined();
    expect(JSON.stringify(value)).not.toContain('person@example.test');
    expect(JSON.stringify(value)).not.toContain('VOIE FICTIVE');
    expect(value.personnePhysique.dateDeNaissance).toBe('1985-02');
  });
  it('refuse les sorties hors dossier et les faux PDF',()=>{
    expect(()=>safeInpiOutputDirectory('../elsewhere')).toThrow();
    expect(()=>assertInpiDocumentId('../../secret')).toThrow();
    expect(()=>assertInpiPdf(Buffer.from('<html>'), 'text/html')).toThrow();
    expect(()=>assertInpiPdf(Buffer.from('%PDF-1.7\n'), 'application/pdf')).not.toThrow();
  });
  it('ne compte pas deux fois le prix d’une mutation',()=>{
    const row={id_mutation:'fixture-sale',date_mutation:'2020-01-01',valeur_fonciere:'100000',nature_mutation:'Vente',nom_commune:'Commune fictive',id_parcelle:'fixture-parcel'};
    const grouped=groupDvfRows([{...row,lot1_numero:'1'},{...row,lot1_numero:'2'}]);
    expect(grouped).toHaveLength(1);expect(grouped[0]?.value).toBe(100000);
  });
  it('calcule une marge sans déduire les revenus du dirigeant',()=>{
    const r=buildEconomicFootprint({...company,finances:{'2023':{ca:100000,resultat_net:10000},'2022':{ca:80000,resultat_net:8000}}}) as any;
    expect(r.financialHistory[0].netMargin.value).toBe(10);
    expect(r.financialHistory[0].netMargin.status).toBe('calculated');
    expect(r.valuation.disclaimer).toMatch(/personnelle/);
  });
});
