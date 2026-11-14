# ICON — Version 0.2.1

ICON est un centre de contrôle PC local développé avec Electron. Aucun compte utilisateur ni inscription n'est requis ; les informations système restent sur l'ordinateur.

## Fonctions présentes

- Écran de lancement animé, accueil et visite guidée locale.
- Mesures CPU et RAM, détection des volumes logiques et actualisation périodique.
- Inventaire matériel Windows via PowerShell/CIM : système, processeur, GPU, barrettes RAM, carte mère, BIOS, disques, réseau et écrans lorsque Windows fournit ces informations.
- Export local d'un rapport JSON.
- Paramètres et vérification, téléchargement et installation des mises à jour GitHub Releases.

## Limites connues

L'analyse détaillée de l'espace disque, la liste des processus, la détection des éléments cachés, l'antivirus et l'optimisation restent à construire. ICON n'affiche pas de résultat antivirus fictif. L'inventaire matériel approfondi est actuellement disponible sous Windows.

## Lancer localement

Prérequis : Node.js 20+ et npm.

```powershell
npm install
npm start
```

## Construire l'installateur Windows

Double-clique sur `BUILD-ICON.cmd`. Le setup est généré dans `dist/ICON-Setup-0.2.1.exe`.

## Publier une version

1. Augmenter `version` dans `package.json` (par exemple `0.2.2`).
2. Envoyer les changements sur la branche `main`.
3. GitHub Actions vérifie si une Release portant ce numéro existe déjà. Si elle n'existe pas, il crée le tag, compile l'installateur Windows et publie automatiquement la GitHub Release.
4. Les utilisateurs ouvrent **Paramètres → Mises à jour** dans ICON pour vérifier la nouvelle version, la télécharger puis l'installer après validation et redémarrage.

Aucune action manuelle dans l'onglet Actions n'est requise pour les versions suivantes. Le dépôt doit rester public. Le jeton `GITHUB_TOKEN` est utilisé uniquement par GitHub Actions ; aucun jeton personnel n'est intégré à ICON.
