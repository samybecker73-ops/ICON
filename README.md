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
2. Envoyer le commit sur `main`.
3. Ouvrir GitHub → **Actions** → **ICON Release** → **Run workflow**.
4. Indiquer le tag correspondant, par exemple `v0.2.2`.
5. GitHub Actions vérifie la version, compile le setup Windows et publie les fichiers de mise à jour dans GitHub Releases.

Les utilisateurs de la version installée peuvent ensuite ouvrir **Paramètres → Mises à jour** pour vérifier la disponibilité, télécharger la nouvelle version et l'installer après validation et redémarrage.

Le dépôt doit rester public. Le jeton `GITHUB_TOKEN` est utilisé uniquement par GitHub Actions pour publier les Releases ; aucun jeton personnel n'est intégré à ICON.
