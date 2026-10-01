# Outils et sources

Le serveur local expose 18 outils MCP. Le modèle de votre client décide lesquels appeler et rédige la synthèse. Les fonctions ci-dessous ne sont pas un moteur autonome de recherche exhaustive.

| Outil | Fonction | Accès |
|---|---|---|
| `resolve_company` | Résoudre un nom ou un SIREN et signaler les ambiguïtés | Public |
| `get_company_snapshot` | Identité, établissements et mandats disponibles | Public |
| `search_person_mandates` | Chercher des mandats candidats et comparer les identités | Public |
| `build_company_mandate_graph` | Construire un graphe borné à partir des mandats | Public |
| `get_bodacc_history` | Collecter les annonces commerciales | Public |
| `search_adlc_sanctions` | Chercher dans le jeu de sanctions financières AdLC | Public |
| `triage_company` | Premier état des données et points à examiner | Public |
| `route_regulatory_checks` | Proposer les registres à contrôler selon le secteur | Local, ne consulte pas les registres |
| `build_company_investigation_report` | Assembler les résultats et leur couverture | Selon les sources demandées |
| `get_inpi_rne_record` | Consulter une fiche RNE accessible | INPI |
| `get_inpi_attachments` | Inventorier les pièces accessibles | INPI |
| `download_inpi_act_pdf` | Télécharger un acte PDF | INPI |
| `download_inpi_balance_pdf` | Télécharger des comptes PDF | INPI |
| `get_inpi_structured_balance` | Récupérer les comptes structurés disponibles | INPI |
| `search_judilibre` | Rechercher des décisions publiées | PISTE / Judilibre |
| `get_judilibre_decision` | Lire une décision identifiée | PISTE / Judilibre |
| `query_dvf_property_transactions` | Rechercher des mutations immobilières dans un périmètre | Fichiers publics DVF |
| `analyze_economic_footprint` | Calculer des indicateurs à partir des données fournies | Local |

## Interpréter les résultats

**Identité.** La recherche s'appuie sur l'[API Recherche d'entreprises](https://recherche-entreprises.api.gouv.fr/). Les mandats exposés ne sont pas un registre exhaustif de tous les liens historiques. Un nom identique ne suffit pas pour attribuer un mandat.

**Annonces.** Le [BODACC](https://www.bodacc.fr/pages/donnees-ouvertes-et-api/) publie des annonces datées. La date de publication peut différer de celle de l'événement. Une annonce ancienne ne décrit pas nécessairement la situation actuelle.

**Sanctions.** Le connecteur consulte le [jeu de sanctions financières AdLC depuis 2009](https://www.data.gouv.fr/datasets/entreprises-sanctionnees-financierement-par-lautorite-de-la-concurrence-depuis-2009), avec recherche textuelle. Vérifier l'entreprise, la décision et ses suites. Ce jeu ne couvre pas toutes les autorités ni tous les recours.

**Actes et comptes.** Une liste de pièces établit leur disponibilité, pas leur contenu. Lire chaque acte utilisé comme preuve. Les ratios calculés ne constituent ni une valorisation, ni une évaluation de la fortune d'une personne.

**DVF.** Les fichiers départementaux peuvent être volumineux. Borner année, département et critères avant de les charger. DVF décrit des transactions, pas l'identité du propriétaire actuel. Une adresse de siège ne prouve pas que la société possède le local. La couverture territoriale et temporelle doit être vérifiée.

**Contrôles réglementaires.** `routed_not_checked` signifie « contrôle proposé, non réalisé ». Les liens vers des registres sont des pistes à ouvrir avec un outil approprié. Ni ce statut ni une source indisponible ne peuvent être présentés comme un contrôle réussi.

**Graphes.** Chaque lien doit préciser son type, sa source, sa date et son niveau de certitude. Un graphe est limité par la profondeur et le nombre de résultats demandés. Il n'est jamais automatiquement complet.

## MCP complémentaires

data.gouv.fr, Origami, OpenLégi et les lecteurs de documents sont des connexions distinctes. L'agent découvre ceux qui sont disponibles puis applique les déclencheurs de [la skill](../.agents/skills/osint-business/SKILL.md), sans attendre une nouvelle demande. Leur installation est facultative ; leur usage fait partie de la recherche lorsqu'ils sont connectés et pertinents. Voir [ACCES.md](ACCES.md). Une page de catalogue ou un résultat de recherche n'est pas la preuve contenue dans le document sous-jacent.

Le serveur transmet aussi ces consignes au client dans les instructions d'initialisation MCP. Il ne peut ni voir les autres serveurs connectés au client, ni les appeler lui-même : c'est l'agent qui coordonne les appels. La présence des instructions ne garantit pas à elle seule leur respect par chaque modèle. Vérifier dans le rapport les consultations réellement effectuées et les limites signalées.

## Vérification du logiciel

La compilation, les tests unitaires et le test du transport MCP peuvent être exécutés sans identifiant. Ils contrôlent les transformations, les erreurs et le protocole sur des cas fictifs. Ils ne certifient pas la disponibilité permanente des fournisseurs. Les interfaces, quotas, formats et droits peuvent changer.
