import type { PublicCompany } from "../connectors/recherche-entreprises.js";

export type RegulatoryPriority = "high" | "medium" | "low";
export type RegulatorySelection = "universal" | "sector_match" | "contextual";
export type RegulatoryAccessMode =
  | "direct_api"
  | "data_gouv_mcp"
  | "official_register"
  | "official_web";

export interface RegulatorySourceRoute {
  name: string;
  publisher: string;
  officialUrl: string;
  accessMode: RegulatoryAccessMode;
}

export interface RegulatoryRoute {
  id: string;
  title: string;
  priority: RegulatoryPriority;
  selection: RegulatorySelection;
  reason: string;
  matchedBy: string[];
  sources: RegulatorySourceRoute[];
  recommendedAction: string;
  expectedEvidence: string[];
  limitations: string[];
  executionStatus: "routed_not_checked";
  supportsNegativeConclusion: false;
  zeroCost: true;
}

export interface RegulatoryRoutingResult {
  generatedAt: string;
  company: {
    siren: string;
    name: string;
    activityCode?: string;
    normalizedActivityCode?: string;
    division?: string;
  };
  selectedRoutes: RegulatoryRoute[];
  contextualRoutes: RegulatoryRoute[];
  methodology: string[];
  warning: string;
}

interface RegulatoryRule {
  id: string;
  title: string;
  priority: RegulatoryPriority;
  nafPrefixes: string[];
  sources: RegulatorySourceRoute[];
  recommendedAction: (company: PublicCompany) => string;
  expectedEvidence: string[];
  limitations: string[];
}

function normalizeNaf(value?: string): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function routeSource(
  name: string,
  publisher: string,
  officialUrl: string,
  accessMode: RegulatoryAccessMode,
): RegulatorySourceRoute {
  return { name, publisher, officialUrl, accessMode };
}

const REGULATORY_RULES: RegulatoryRule[] = [
  {
    id: "finance-authorizations",
    title: "Agréments et habilitations banque, assurance et finance",
    priority: "high",
    nafPrefixes: ["64", "65", "66"],
    sources: [
      routeSource(
        "REGAFI, registre banque et assurance",
        "ACPR / Banque de France",
        "https://acpr.banque-france.fr/fr/professionnels/vos-outils-et-services/consulter-les-registres/registre-des-agents-financiers-et-des-organismes-dassurance",
        "official_register",
      ),
      routeSource(
        "Registre unique des intermédiaires",
        "ORIAS",
        "https://www.orias.fr/",
        "official_register",
      ),
      routeSource(
        "Décisions et listes professionnelles",
        "Autorité des marchés financiers",
        "https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/listes-blanches",
        "official_web",
      ),
    ],
    recommendedAction: (company) =>
      `Rechercher le SIREN ${company.siren} et les dénominations de ${company.nom_complet} dans REGAFI, ORIAS et les listes AMF applicables, puis relever le périmètre et la validité des habilitations.`,
    expectedEvidence: [
      "identifiant de registre et catégorie d’agrément",
      "périmètre d’activité autorisé et dates disponibles",
      "écart éventuel entre activité déclarée et habilitation retrouvée",
    ],
    limitations: [
      "Le code NAF ne prouve pas qu’un agrément est juridiquement requis pour chaque activité réellement exercée.",
      "Une absence doit être vérifiée avec les variantes de dénomination et les régimes de passeport européen.",
    ],
  },
  {
    id: "cnaps-authorizations",
    title: "Autorisations et sanctions de sécurité privée",
    priority: "high",
    nafPrefixes: ["801", "802", "803"],
    sources: [
      routeSource(
        "Téléservices, entreprises autorisées et sanctions",
        "CNAPS",
        "https://www.cnaps.interieur.gouv.fr/Publications/Autres-publications/Entreprises-autorisees/Entreprises-de-securite-privee-autorisees-a-exercer-par-le-CNAPS",
        "official_register",
      ),
    ],
    recommendedAction: (company) =>
      `Vérifier le SIRET de chaque établissement de ${company.nom_complet} dans les téléservices CNAPS et rechercher séparément les décisions publiées concernant la personne morale.`,
    expectedEvidence: [
      "autorisation d’exercice horodatée par établissement",
      "agréments publics pertinents",
      "décisions disciplinaires publiées et état des recours",
    ],
    limitations: [
      "La liste téléchargeable ne remplace pas la vérification horodatée dans le téléservice CNAPS.",
      "Une décision ancienne ou homonyme doit être attribuée par identifiants et dates.",
    ],
  },
  {
    id: "legal-professional-register",
    title: "Registre professionnel des avocats",
    priority: "high",
    nafPrefixes: ["6910"],
    sources: [
      routeSource(
        "Annuaire national des avocats",
        "Conseil national des barreaux",
        "https://www.cnb.avocat.fr/fr/annuaire-des-avocats-de-france",
        "official_register",
      ),
    ],
    recommendedAction: (company) =>
      `Recouper la structure ${company.nom_complet} et ses avocats actuels dans l’annuaire CNB et auprès du barreau indiqué.`,
    expectedEvidence: [
      "inscriptions professionnelles actuelles",
      "barreau et forme d’exercice publiés",
      "cohérence avec les représentants et la présentation publique de la structure",
    ],
    limitations: [
      "L’annuaire ne constitue pas un historique disciplinaire exhaustif.",
      "L’activité juridique peut couvrir d’autres professions réglementées qui nécessitent leur propre annuaire.",
    ],
  },
  {
    id: "architects-professional-register",
    title: "Inscription professionnelle des architectes",
    priority: "high",
    nafPrefixes: ["7111"],
    sources: [
      routeSource(
        "Tableau de l’Ordre des architectes",
        "Conseil national de l’Ordre des architectes",
        "https://annuaire.architectes.org/",
        "official_register",
      ),
    ],
    recommendedAction: (company) =>
      `Rechercher ${company.nom_complet}, ses représentants et ses variantes dans le Tableau de l’Ordre, puis relever le mode d’exercice, la région d’inscription et l’habilitation publiée.`,
    expectedEvidence: [
      "identité ou dénomination exactement attribuée",
      "matricule, région et mode d’exercice publiés",
      "habilitation à établir des projets sous la responsabilité indiquée",
    ],
    limitations: [
      "Le code NAF 71.11Z ne prouve pas à lui seul une inscription à l’Ordre.",
      "Une activité d’architecture intérieure peut relever d’un périmètre distinct du titre réglementé d’architecte.",
      "Un résultat nul ne couvre que les variantes, la région et les filtres effectivement interrogés.",
    ],
  },
  {
    id: "industrial-environment-icpe",
    title: "Installations classées, inspections et risques industriels",
    priority: "high",
    nafPrefixes: [
      "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16",
      "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28",
      "29", "30", "31", "32", "33", "35", "36", "37", "38", "39",
    ],
    sources: [
      routeSource(
        "Installations industrielles et ICPE",
        "Géorisques / Ministère de la Transition écologique",
        "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
        "official_web",
      ),
    ],
    recommendedAction: (company) =>
      `Résoudre les établissements de ${company.nom_complet}, puis rechercher chaque SIRET et adresse d’exploitation dans Géorisques afin de lire régime, inspections et documents publics.`,
    expectedEvidence: [
      "correspondance SIRET et installation",
      "régime ICPE, état d’activité et statut Seveso/IED le cas échéant",
      "inspections, suites et documents publiés avec dates",
    ],
    limitations: [
      "Le code NAF ne prouve pas qu’un établissement est classé ICPE.",
      "Une adresse de siège ne doit pas être confondue avec un site industriel exploité.",
    ],
  },
  {
    id: "consumer-products-recalls",
    title: "Rappels de produits et publications DGCCRF",
    priority: "medium",
    nafPrefixes: [
      "10", "11", "12", "13", "14", "15", "16", "17", "18", "20", "21", "22",
      "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "45", "46",
      "47", "55", "56",
    ],
    sources: [
      routeSource(
        "RappelConso, données ouvertes",
        "DGCCRF / DGAL / DGEC / DGPR",
        "https://rappel.conso.gouv.fr/support/open-data",
        "data_gouv_mcp",
      ),
      routeSource(
        "Injonctions et sanctions",
        "DGCCRF",
        "https://www.economie.gouv.fr/dgccrf/injonctions-et-sanctions",
        "official_web",
      ),
    ],
    recommendedAction: (company) =>
      `Avec le MCP data.gouv.fr, rechercher le jeu RappelConso puis interroger les dénominations, marques démontrées et identifiants de ${company.nom_complet}; compléter par les publications DGCCRF.`,
    expectedEvidence: [
      "fiche de rappel, référence produit et date",
      "lien démontré entre marque, responsable déclaré et SIREN",
      "injonction ou sanction, base légale et statut publié",
    ],
    limitations: [
      "Une marque ou un distributeur cité ne doit pas être attribué à la société sans lien documentaire.",
      "Les publications administratives peuvent être temporaires et ne couvrent pas tout l’historique.",
    ],
  },
  {
    id: "data-protection-cnil",
    title: "Décisions et sanctions de protection des données",
    priority: "medium",
    nafPrefixes: [
      "58", "59", "60", "61", "62", "63", "731", "732", "781", "782", "783", "822",
      "86",
    ],
    sources: [
      routeSource(
        "Décisions et sanctions",
        "CNIL",
        "https://www.cnil.fr/fr/textes-officiels/les-decisions-de-la-cnil",
        "official_web",
      ),
      routeSource(
        "Décisions CNIL",
        "Légifrance",
        "https://www.legifrance.gouv.fr/cnil/",
        "official_web",
      ),
    ],
    recommendedAction: (company) =>
      `Rechercher le SIREN et toutes les dénominations de ${company.nom_complet} dans les décisions CNIL et Légifrance, puis distinguer sanction, mise en demeure et clôture.`,
    expectedEvidence: [
      "type de décision, date et référence",
      "manquements retenus et mesures prononcées",
      "clôture, recours ou caractère définitif lorsqu’ils sont publiés",
    ],
    limitations: [
      "Certaines sanctions simplifiées sont anonymisées.",
      "L’absence de décision nominative publiée ne prouve pas l’absence de contrôle ou de procédure.",
    ],
  },
  {
    id: "health-products-authorizations",
    title: "Produits de santé, établissements et décisions sanitaires",
    priority: "high",
    nafPrefixes: ["21", "266", "325", "4646", "4773", "86"],
    sources: [
      routeSource(
        "Décisions, injonctions et informations de sécurité",
        "ANSM",
        "https://ansm.sante.fr/",
        "official_web",
      ),
      routeSource(
        "Répertoire partagé des professionnels intervenant dans le système de santé",
        "Agence du Numérique en Santé",
        "https://annuaire.sante.fr/",
        "official_register",
      ),
    ],
    recommendedAction: (company) =>
      `Qualifier précisément l’activité santé de ${company.nom_complet}, puis vérifier les établissements, autorisations, injonctions et décisions ANSM ainsi que les inscriptions professionnelles applicables.`,
    expectedEvidence: [
      "catégorie réglementaire exacte du produit ou de l’établissement",
      "autorisation ou inscription avec identifiant et dates",
      "décisions, rappels ou injonctions publiés",
    ],
    limitations: [
      "Le code NAF ne distingue pas médicament, dispositif médical, officine et prestation de soins.",
      "Chaque sous-secteur relève de registres et autorités différents qu’il faut qualifier avant recherche.",
    ],
  },
  {
    id: "road-transport-register",
    title: "Licences de transport routier et commissionnaires",
    priority: "high",
    nafPrefixes: ["493", "494", "5229"],
    sources: [
      routeSource(
        "Registre électronique national des entreprises de transport par route",
        "Ministère chargé des Transports",
        "https://www.ecologie.gouv.fr/politiques-publiques/liste-entreprises-inscrites-registre-electronique-national-entreprises",
        "official_register",
      ),
    ],
    recommendedAction: (company) =>
      `Rechercher le SIREN ${company.siren} dans les listes nationales transporteurs et commissionnaires, puis contrôler le type et la période de validité des licences.`,
    expectedEvidence: [
      "inscription au registre concerné",
      "type de licence et dates de validité",
      "activité marchandises, voyageurs ou commissionnaire correctement qualifiée",
    ],
    limitations: [
      "La route ne couvre pas automatiquement les agréments aérien, maritime ou ferroviaire.",
      "Le code NAF seul ne prouve pas l’exercice effectif d’une activité soumise à licence.",
    ],
  },
  {
    id: "construction-qualifications",
    title: "Qualifications RGE et contrôles propres à la construction",
    priority: "medium",
    nafPrefixes: ["41", "42", "43"],
    sources: [
      routeSource(
        "Annuaire des entreprises qualifiées RGE",
        "ADEME",
        "https://data.ademe.fr/datasets/liste-des-entreprises-rge-2",
        "data_gouv_mcp",
      ),
    ],
    recommendedAction: (company) =>
      `Avec le MCP data.gouv.fr, retrouver le jeu des entreprises RGE et interroger le SIRET de chaque établissement de ${company.nom_complet}, avec domaine et période de validité.`,
    expectedEvidence: [
      "SIRET qualifié",
      "organisme, domaine et qualification",
      "dates de validité de la qualification",
    ],
    limitations: [
      "Une qualification RGE ne remplace ni l’attestation d’assurance ni son contrôle auprès de l’assureur.",
      "L’absence de RGE n’est pas une irrégularité pour toutes les prestations de construction.",
    ],
  },
  {
    id: "training-provider-register",
    title: "Déclaration d’activité et certification des organismes de formation",
    priority: "medium",
    nafPrefixes: ["855", "856"],
    sources: [
      routeSource(
        "Liste publique des organismes de formation",
        "Ministère du Travail",
        "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail/",
        "data_gouv_mcp",
      ),
    ],
    recommendedAction: (company) =>
      `Avec le MCP data.gouv.fr, interroger le SIREN ${company.siren} dans la liste publique des organismes de formation et relever déclaration d’activité et certification qualité publiées.`,
    expectedEvidence: [
      "numéro de déclaration d’activité",
      "état déclaratif publié",
      "certification qualité et catégories d’actions lorsqu’elles figurent dans le jeu",
    ],
    limitations: [
      "La déclaration d’activité ne vaut pas agrément de l’État.",
      "Le périmètre exact d’une certification doit être lu dans la donnée datée.",
    ],
  },
];

function universalAssetFreezeRoute(company: PublicCompany): RegulatoryRoute {
  return {
    id: "asset-freezes",
    title: "Registre national des gels d’avoirs",
    priority: "high",
    selection: "universal",
    reason: "Contrôle transversal applicable aux personnes physiques et morales, indépendamment du secteur.",
    matchedBy: ["universal"],
    sources: [
      routeSource(
        "Registre national des gels d’avoirs, API publique",
        "Direction générale du Trésor",
        "https://gels-avoirs.dgtresor.gouv.fr/ApiPublic/",
        "direct_api",
      ),
    ],
    recommendedAction:
      `Interroger la dernière publication JSON avec un User-Agent explicite pour ${company.nom_complet}, ses variantes et ses représentants, puis confirmer toute correspondance par identifiants, alias et mesure source.`,
    expectedEvidence: [
      "date de la publication consultée",
      "identité ou dénomination visée et alias",
      "fondement, autorité et mesure en vigueur",
    ],
    limitations: [
      "Une correspondance de nom seule reste un candidat et ne doit jamais être présentée comme établie.",
      "Un résultat nul ne couvre que la publication et les variantes effectivement interrogées.",
    ],
    executionStatus: "routed_not_checked",
    supportsNegativeConclusion: false,
    zeroCost: true,
  };
}

function contextualHatvpRoute(company: PublicCompany): RegulatoryRoute {
  return {
    id: "hatvp-representation-interests",
    title: "Représentation d’intérêts et exposition publique déclarée",
    priority: "medium",
    selection: "contextual",
    reason:
      "À activer lorsqu’une activité de représentation d’intérêts, des relations publiques ou un lien avec des décideurs publics est documenté ; le code NAF seul ne suffit pas.",
    matchedBy: ["context_required"],
    sources: [
      routeSource(
        "Répertoire des représentants d’intérêts",
        "Haute Autorité pour la transparence de la vie publique",
        "https://www.data.gouv.fr/datasets/repertoire-des-representants-dinterets/",
        "data_gouv_mcp",
      ),
    ],
    recommendedAction:
      `Si le contexte le justifie, utiliser le MCP data.gouv.fr pour rechercher ${company.nom_complet}, le SIREN ${company.siren}, ses clients ou organisations déclarées dans le répertoire HATVP.`,
    expectedEvidence: [
      "déclaration attribuée par identifiant",
      "organisation, période et objectifs déclarés",
      "personnes ou clients uniquement lorsqu’ils sont explicitement publiés",
    ],
    limitations: [
      "Une absence du répertoire ne prouve pas l’absence de relations avec la sphère publique.",
      "Une homonymie ou une proximité politique supposée ne doit jamais fonder un rattachement.",
    ],
    executionStatus: "routed_not_checked",
    supportsNegativeConclusion: false,
    zeroCost: true,
  };
}

function matchesRule(naf: string, rule: RegulatoryRule): string[] {
  return rule.nafPrefixes.filter((prefix) => naf.startsWith(prefix));
}

export function routeRegulatoryChecks(
  company: PublicCompany,
  generatedAt = new Date().toISOString(),
): RegulatoryRoutingResult {
  const naf = normalizeNaf(company.activite_principale);
  const sectorRoutes = REGULATORY_RULES.flatMap((rule): RegulatoryRoute[] => {
    const matchingPrefixes = matchesRule(naf, rule);
    if (matchingPrefixes.length === 0) return [];
    return [{
      id: rule.id,
      title: rule.title,
      priority: rule.priority,
      selection: "sector_match",
      reason: `Le code NAF ${company.activite_principale ?? "non renseigné"} correspond à la règle sectorielle ${matchingPrefixes.join(", ")}.`,
      matchedBy: matchingPrefixes.map((prefix) => `naf_prefix:${prefix}`),
      sources: rule.sources,
      recommendedAction: rule.recommendedAction(company),
      expectedEvidence: rule.expectedEvidence,
      limitations: rule.limitations,
      executionStatus: "routed_not_checked",
      supportsNegativeConclusion: false,
      zeroCost: true,
    }];
  });
  const priority = { high: 0, medium: 1, low: 2 } as const;
  const selectedRoutes = [universalAssetFreezeRoute(company), ...sectorRoutes]
    .sort((left, right) => priority[left.priority] - priority[right.priority]);

  return {
    generatedAt,
    company: {
      siren: company.siren,
      name: company.nom_complet,
      ...(company.activite_principale
        ? {
            activityCode: company.activite_principale,
            normalizedActivityCode: naf,
            division: naf.slice(0, 2),
          }
        : {}),
    },
    selectedRoutes,
    contextualRoutes: [contextualHatvpRoute(company)],
    methodology: [
      "Le SIREN verrouille le pivot ; le code NAF sert seulement à sélectionner des sources, jamais à établir une obligation ou une infraction.",
      "Les routes universelles et sectorielles sont gratuites et officielles ; data.gouv.fr est utilisé pour découvrir ou interroger les jeux ouverts quand indiqué.",
      "Chaque route reste non exécutée jusqu’à l’interrogation effective de la source et à la désambiguïsation des résultats.",
    ],
    warning:
      "Ce routage n’est ni un audit de conformité ni un résultat de sanction. Il ne permet aucune conclusion négative avant exécution documentée des contrôles.",
  };
}
