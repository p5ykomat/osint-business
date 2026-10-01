---
name: osint-business
description: Rechercher une entreprise française, désambiguïser ses dirigeants, explorer les sociétés liées et produire des constats sourcés avec les outils OSINT Business disponibles.
---

# Recherche relationnelle sur les entreprises françaises

## 1. Identifier

Relever le nom ou le SIREN, le périmètre, la période et le résultat attendu. Appeler `resolve_company` avant les approfondissements. En présence d'homonymes, demander un identifiant ou un contexte professionnel, sans choisir le premier résultat. Vérifier la forme juridique : une entreprise individuelle n'a pas les mêmes obligations de comptes qu'une société.

## 2. Collecter

Appeler `get_company_snapshot`, `get_bodacc_history` et `route_regulatory_checks`. Distinguer l'entreprise de ses établissements et les dates de fermeture des dates de radiation. Pour chaque source, noter couverture, date, filtres, résultat et échec éventuel.

Les outils INPI nécessitent les accès personnels de l'utilisateur. Après `get_inpi_attachments`, télécharger les actes utiles avec `download_inpi_act_pdf`. Lire leur contenu dans le client ou avec un outil documentaire installé avant de les citer. Les comptes PDF et structurés ont des outils distincts. Ne jamais contourner une confidentialité ou une authentification.

## 3. Explorer les ramifications

Utiliser `build_company_mandate_graph` puis `search_person_mandates` pour les identités suffisamment désambiguïsées. Examiner les SCI et sociétés civiles autant que les sociétés commerciales. Déplier chaque branche matérielle à partir de son SIREN, sans transformer toutes les pistes en affirmations.

Pour chaque chemin : entité de départ, type de lien, date, source, entité d'arrivée, limite. Le niveau de confiance du chemin est celui de son maillon le plus faible. Une adresse partagée reste un indice de recherche. Un mandat ne prouve ni détention, ni rémunération, ni propriété d'un bien.

Après lecture des actes, refaire un passage sur les noms, sociétés et dates nouvellement établis. S'arrêter lorsque les nouvelles branches sont redondantes, homonymes, hors périmètre ou non documentées. Signaler la profondeur réellement parcourue et les plafonds appliqués.

## 4. Vérifier le contexte

Le routeur réglementaire retourne des contrôles proposés. Exécuter ceux qui sont pertinents avec les outils réellement disponibles ; sinon les marquer non vérifiés. Utiliser data.gouv.fr pour découvrir les jeux et lire leurs ressources, sans confondre une notice avec les données.

Pour le droit des sociétés, les procédures et la réglementation sectorielle : rechercher textes et décisions, vérifier version en vigueur, date d'effet, rôle de l'entreprise et recours. Judilibre est une base de décisions publiées, pas un casier judiciaire. Un MCP juridique optionnel peut compléter les connecteurs natifs ; citer les publications officielles.

## 5. Restituer

`build_company_investigation_report` assemble les données et expose les lacunes. Lui transmettre seulement les constats issus de pièces réellement lues et les chemins étayés. Ajouter l'analyse narrative dans le client IA, sans inventer de contrôles exécutés.

Livrer : identité et périmètre ; graphe sourcé ; chronologie ; faits matériels ; comptes disponibles ; contradictions ; tableau des sources vérifiées/non vérifiées ; prochaines recherches utiles. Séparer chiffres publiés, calculs et scénarios. Ne pas déduire le patrimoine ou le revenu d'une personne du bilan d'une entreprise.

Conserver les résultats dans `output/`. Export PDF seulement si un outil de rendu est disponible ; contrôler le document obtenu. Aucun nom, dossier ou résultat réel ne doit entrer dans le code partagé.
