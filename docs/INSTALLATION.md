# Installer OSINT Business

## 1. Préparer votre ordinateur

Installez [Node.js 24 LTS](https://nodejs.org/) puis Codex ou Claude Code avec votre compte habituel. Node.js fait fonctionner les outils locaux ; votre client IA assure la conversation et le raisonnement. Python n'est pas nécessaire pour le cœur du projet.

Téléchargez **Code → Download ZIP** sur la page GitHub. Décompressez l'archive dans un dossier que vous garderez. Sous Windows, ouvrez ce dossier, puis clic droit **Ouvrir dans le Terminal**. Sur macOS ou Linux, ouvrez un terminal et placez-vous dans le dossier.

Si vous utilisez déjà Git :

```sh
git clone https://github.com/p5ykomat/osint-business.git
cd osint-business
```

Vérifiez que vous êtes dans le dossier contenant `package.json` :

```sh
node --version
npm --version
npm run setup
```

Sous PowerShell, si `npm.ps1` est bloqué, utilisez `npm.cmd run setup`. Il n'est pas nécessaire de désactiver la protection de votre système.

L'installation télécharge les dépendances verrouillées, compile le programme, crée un fichier `.env` vide si nécessaire et prépare deux fichiers dans `artifacts/`. Elle ne modifie pas vos réglages IA.

## 2. Connecter Codex

Ouvrez ce dossier comme projet dans Codex. Ajoutez les blocs de `artifacts/codex-config.txt` à votre configuration MCP Codex, en conservant les autres serveurs existants. Ne remplacez pas tout votre fichier de configuration. Le fichier généré contient les chemins exacts de votre ordinateur et aucune clé.

La configuration peut être placée dans `.codex/config.toml` à la racine du projet, après avoir accordé votre confiance au dossier, ou fusionnée dans votre configuration utilisateur. Redémarrez la session Codex après modification. [Documentation officielle MCP de Codex](https://developers.openai.com/codex/mcp/).

Autre possibilité, avec le programme `codex` disponible dans votre terminal, depuis le dossier du projet :

Windows PowerShell :

```powershell
$launcher = (Resolve-Path .\scripts\start.mjs).Path
codex mcp add osint_business -- node "$launcher"
codex mcp add data_gouv --url https://mcp.data.gouv.fr/mcp
codex mcp list
```

macOS et Linux :

```sh
codex mcp add osint_business -- node "$(pwd)/scripts/start.mjs"
codex mcp add data_gouv --url https://mcp.data.gouv.fr/mcp
codex mcp list
```

Choisissez une seule méthode d'ajout pour éviter les doublons. Le fichier `AGENTS.md` et la skill dans `.agents/skills/` apportent la méthode lorsque vous travaillez dans ce projet. Ajouter seulement le serveur à un autre projet n'y installe pas automatiquement ces instructions.

## 3. Ou connecter Claude Code

Ouvrez un terminal dans le dossier du projet. Si `claude` est installé, ajoutez le serveur local :

Windows PowerShell :

```powershell
$launcher = (Resolve-Path .\scripts\start.mjs).Path
claude mcp add --transport stdio --scope local osint_business -- node "$launcher"
claude mcp add --transport http --scope local data_gouv https://mcp.data.gouv.fr/mcp
claude mcp list
```

macOS et Linux :

```sh
claude mcp add --transport stdio --scope local osint_business -- node "$(pwd)/scripts/start.mjs"
claude mcp add --transport http --scope local data_gouv https://mcp.data.gouv.fr/mcp
claude mcp list
```

Lancez `claude` dans ce dossier, puis `/mcp` pour vérifier les connexions. Acceptez le serveur après lecture du code et de sa provenance. `CLAUDE.md` renvoie vers les instructions du projet.

Si vous préférez une configuration JSON, `artifacts/claude-code-config.json` fournit le bloc local prêt à fusionner dans `.mcp.json`. Ce fichier est ignoré par Git ici. Ne remplacez pas vos autres serveurs. [Documentation officielle Claude Code](https://code.claude.com/docs/en/mcp).

## 4. Vérifier sans dépenser de crédit IA

```sh
npm run doctor
npm run smoke
```

`doctor` indique si le programme est compilé et si les champs d'accès optionnels sont remplis. Il ne révèle pas leurs valeurs et ne valide pas vos droits chez le fournisseur.

`smoke` lance le serveur, découvre les 18 outils puis envoie un argument invalide. Il n'appelle pas de modèle IA ni de registre. Le programme se ferme après le contrôle.

Ensuite, dans votre agent :

> Lis AGENTS.md et la skill OSINT Business. Liste les sources réellement accessibles. Ne lance pas encore de recherche. Indique les accès facultatifs absents.

Cette conversation utilise votre offre IA habituelle. Pour une première enquête, remplacez le sujet dans [cet exemple](../examples/premiere-recherche.md).

## 5. Ajouter les accès facultatifs

Suivez [ACCES.md](ACCES.md). Modifiez votre `.env` local avec un éditeur, puis reconnectez le MCP. Ne collez jamais un secret dans la conversation ou dans une commande conservée par le terminal.

## Dépannage

| Message ou symptôme | Action |
|---|---|
| `node` ou `npm` introuvable | Installer Node.js puis rouvrir le terminal et le client IA. |
| Programme non compilé | Relancer `npm run setup` dans le dossier qui contient `package.json`. |
| Le MCP ne démarre pas | Lancer `npm run smoke`, vérifier les chemins et redémarrer le client. |
| Les outils existent mais l'agent ignore la méthode | Ouvrir le dossier du dépôt et lui demander de lire `AGENTS.md`. |
| INPI ou PISTE absent | Compléter les deux champs du service concerné dans `.env`. |
| HTTP 401 ou 403 | Vérifier ses identifiants, l'environnement de production et les droits accordés. |
| HTTP 429 | Arrêter les appels et respecter le délai/quota du fournisseur. |
| Temps dépassé | Réduire la profondeur du graphe ou le nombre de sources, puis reprendre les seules étapes manquantes. |
| Aucune pièce disponible | Vérifier la couverture et la confidentialité ; ne pas en déduire l'absence d'activité. |

Le client lance et ferme le serveur MCP. `npm start` attend des échanges MCP : une fenêtre silencieuse est donc normale, ce n'est pas une interface de discussion.

## Mettre à jour

Avec Git, terminer votre travail, conserver les rapports dans `output/`, puis `git pull --ff-only` et `npm run setup`. Sans Git, récupérer une nouvelle archive dans un autre dossier, recopier uniquement votre `.env` et vos résultats locaux, puis refaire l'installation et la connexion. Ne publier aucun de ces fichiers personnels.

Si vous déplacez le dossier ou changez d'ordinateur, relancez l'installation et actualisez les chemins MCP. Un agent exécuté sur une autre machine ne peut pas utiliser automatiquement ce serveur local.
