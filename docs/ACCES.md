# Configurer ses propres accès

Commencez sans compte externe : l'identité publique des entreprises, les annonces BODACC et le jeu de sanctions AdLC sont accessibles sans identifiant dans les connecteurs fournis. Ajoutez ensuite les services utiles à vos recherches.

## Où mettre ses identifiants

Après `npm run setup`, ouvrez `.env` dans le dossier du projet avec votre éditeur. Remplissez uniquement les lignes nécessaires, en conservant les noms à gauche du signe `=`. Ce fichier est ignoré par Git. Les valeurs restent sur votre ordinateur ; elles sont envoyées au service concerné lors de son authentification.

Pour une valeur contenant des espaces ou `#`, entourez-la de guillemets. Si votre secret comporte lui-même des guillemets, utilisez l'autre type de guillemets. Ne partagez ni capture ni copie du fichier. Redémarrez la connexion MCP après modification.

## INPI : actes, registre et comptes

1. Créez votre compte sur [DATA INPI](https://data.inpi.fr/).
2. Dans votre espace, ouvrez **Mes accès API / SFTP** et consultez les accès entreprises.
3. Demandez les données utiles : formalités RNE, actes et statuts PDF, comptes annuels PDF et données de comptes structurées. Un compte ne garantit pas que tous les accès soient déjà activés.
4. Attendez la confirmation des droits et consultez les conditions de réutilisation.
5. Dans `.env`, complétez `INPI_USERNAME` et `INPI_PASSWORD` avec les identifiants autorisés pour ces API.
6. Reconnectez le MCP. Demandez d'abord une fiche RNE sur un SIREN que vous avez choisi, puis la liste des pièces, avant les téléchargements.

Le connecteur se connecte au RNE et garde le jeton de session en mémoire. Il ne demande pas de clé INSEE. Les pièces confidentielles ou non accessibles avec vos droits ne deviennent pas disponibles grâce au MCP. [Guide d'accès INPI](https://data.inpi.fr/content/editorial/Acces_API_Entreprises).

## Judilibre : décisions publiées

1. Ouvrez la [fiche officielle de l'API Judilibre](https://www.data.gouv.fr/dataservices/api-judilibre) et suivez son lien vers PISTE.
2. Créez votre compte sur [PISTE](https://piste.gouv.fr/).
3. Créez une application de **production** et sélectionnez l'API **Judilibre**. Acceptez les conditions applicables.
4. Récupérez le **Client ID** et le **Client Secret** de cette application.
5. Renseignez `PISTE_CLIENT_ID` et `PISTE_CLIENT_SECRET` dans `.env`.
6. Reconnectez le MCP, puis faites une recherche bornée dans le temps et contrôlez une décision avec `get_judilibre_decision`.

Le connecteur utilise OAuth et l'API de production. Un accès de bac à sable ou une autre API PISTE ne suffit pas. La base couvre des décisions publiées et pseudonymisées, avec une couverture variable. Ne cherchez pas à démasquer les personnes anonymisées.

## data.gouv.fr : découverte de données

Le MCP distant public utilise `https://mcp.data.gouv.fr/mcp`. La configuration Codex générée et les commandes Claude Code du guide d'installation permettent de l'ajouter. Aucune clé personnelle data.gouv.fr n'est embarquée.

Ce MCP découvre des jeux, ressources et API. Il complète les 18 outils locaux. L'agent doit ensuite consulter la ressource, vérifier son producteur, sa date et son périmètre. Certaines API découvertes peuvent avoir leurs propres conditions d'accès.

## Compléments facultatifs

Ces services ne sont pas installés automatiquement. Le programme de base fonctionne sans eux.

### Origami Entreprises

Le [service Origami](https://origami-entreprises.fr/mcp/) propose un MCP d'entreprises à l'adresse `https://mcp.origami-entreprises.fr/mcp`. Ajoutez-le comme serveur HTTP dans votre client et utilisez votre propre compte via son parcours d'authentification. Consultez les conditions et quotas affichés au moment de votre inscription. Le projet n'inclut ni compte ni crédit Origami.

### OpenLégi

Pour compléter une recherche par des textes juridiques, [OpenLégi](https://www.openlegi.fr/documentation/demarrage-rapide/deux-modes-connexion/) expose notamment :

- `https://mcp.openlegi.fr/legifrance/mcp` pour Légifrance ;
- `https://mcp.openlegi.fr/bofip/mcp` pour le BOFiP, si le sujet le justifie.

Créez votre propre accès auprès du service. Utilisez son parcours OAuth si votre client le prend en charge, sinon un jeton personnel configuré par variable d'environnement, selon sa documentation. N'inscrivez pas ce jeton dans une URL ou dans ce dépôt. Ce fournisseur est un intermédiaire : les citations finales doivent permettre de retrouver la publication officielle et sa version.

### Lecture de PDF

Les outils INPI téléchargent les pièces ; ils ne réalisent pas leur OCR. Votre agent peut utiliser ses outils documentaires ou un MCP local tel que [Docling](https://github.com/docling-project/docling-mcp). Suivez les instructions du fournisseur avant de l'ajouter. Contrôlez les passages décisifs, surtout les tableaux et les scans. Les outils de lecture disponibles dépendent de votre installation.

## Ce qu'il n'est pas nécessaire de créer

- Pas de clé de modèle IA dans ce dépôt : Codex ou Claude Code utilisent leur propre connexion.
- Pas de compte d'hébergement.
- Pas de clé INSEE pour les recherches de base : le connecteur fourni utilise l'API Recherche d'entreprises, avec la couverture qu'elle expose. Ce n'est pas une intégration complète de l'API Sirene directe.
- Pas d'abonnement à un agrégateur commercial pour commencer.

Les conditions des services peuvent évoluer. Un champ rempli ne prouve pas qu'un compte est autorisé. `npm run doctor` vérifie la présence des réglages ; seuls des appels effectifs permettent de vérifier les droits.
