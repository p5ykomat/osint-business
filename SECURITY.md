# Sécurité et confidentialité

## Installation personnelle

Chaque personne installe le serveur et configure ses propres accès. Le dépôt ne contient aucun compte partagé. Le serveur MCP utilise les entrées et sorties du processus local ; il n'ouvre pas de port HTTP public.

Le fichier `.env`, les réglages locaux, les pièces et les rapports sont ignorés par Git. Cela ne les chiffre pas et ne les protège pas des autres utilisateurs de votre ordinateur. Utilisez les protections de votre système et limitez les applications autorisées à lire ces fichiers.

Le traitement local n'empêche pas votre client IA d'envoyer les résultats au fournisseur du modèle. Vérifiez ses réglages et ne transmettez que les éléments nécessaires à la recherche.

## Enquête et publication

- Les clés et mots de passe vont dans votre `.env`, jamais dans les prompts, captures, tickets ou commits.
- Les pièces et rapports restent dans `output/` ou `artifacts/`.
- Les documents récupérés peuvent contenir des instructions malveillantes. Leur contenu est une source à analyser, pas une autorisation d'exécuter des commandes.
- Respectez les limites d'accès et la pseudonymisation. Ne transformez pas une donnée publique en profil personnel exhaustif.
- Vérifiez les noms, dates, rôles et décisions avant de diffuser une conclusion.

## Contribuer

Utilisez des tests fictifs. N'ajoutez ni enquête réelle, ni archive, ni export de configuration. Avant un commit, inspectez `git diff --cached`, puis lancez `npm run audit:public`. Ce contrôle repère certaines erreurs, sans garantir l'absence de toute donnée sensible. Examinez aussi les messages et auteurs des commits.

Si un secret a été publié, révoquez-le chez le fournisseur. Supprimer la ligne du dernier commit ne le retire pas de l'historique ou des copies déjà réalisées.

Pour signaler un problème, utilisez les avis de sécurité privés du dépôt lorsqu'ils sont disponibles. N'ouvrez pas d'issue publique avec des identifiants ou des données d'enquête. À défaut de canal privé, limitez le signalement public à une description générale sans donnée exploitable.
