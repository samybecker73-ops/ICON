# ICON

ICON est un centre de contrôle PC local, développé avec Electron. Aucune inscription, aucun compte et aucun envoi de données système vers un serveur ne sont requis.

## Source

La version source actuellement publiée est conservée dans [source/ICON-0.2.1.zip](source/ICON-0.2.1.zip). Extrais l’archive puis ouvre le dossier `ICON-0.2.1`.

## Lancer en développement

Prérequis : Node.js 20+ et npm.

```powershell
npm install
npm start
```

## Construire l’installateur Windows

Depuis le dossier extrait, double-clique sur `BUILD-ICON.cmd`. Le fichier génère l’installateur NSIS dans `dist/`.

## Mises à jour automatiques

La version Windows installée intègre `electron-updater`. Depuis **Paramètres → Mises à jour**, ICON vérifie la GitHub Release publique, propose de télécharger l’installateur et redémarre pour appliquer la mise à jour. Le téléchargement n’est pas imposé à l’utilisateur.

Le dépôt doit rester public. Aucun jeton GitHub personnel n’est intégré à l’application. GitHub Actions utilise uniquement le `GITHUB_TOKEN` automatique avec une permission limitée à la publication de releases.

## Publier une version

1. Augmenter `version` dans le `package.json` du projet.
2. Mettre à jour l’archive source sous `source/` avec le même numéro.
3. Envoyer le changement sur `main`.
4. Dans **Actions → ICON Release**, lancer le workflow en indiquant le tag correspondant, par exemple `v0.2.1`.
5. Le workflow valide que le tag et la version de l’application correspondent, construit le setup Windows et publie les fichiers de mise à jour dans GitHub Releases.

Pour la toute première installation, les utilisateurs doivent installer manuellement `ICON-Setup-0.2.1.exe` depuis la première GitHub Release. Les mises à jour suivantes seront proposées directement dans l’application.

## Fonctions de la version 0.2.1

- Écran de lancement animé et tableau de bord sombre.
- Mesures CPU et RAM, volumes logiques.
- Inventaire matériel Windows via PowerShell/CIM.
- Export local de rapport JSON.
- Visite guidée locale.
- Paramètres et vérification des mises à jour GitHub.

## Limites de la version actuelle

L’analyse détaillée de l’espace disque, les processus, les éléments cachés, l’antivirus et l’optimisation sont prévus pour de prochaines étapes. ICON n’affiche pas de résultat antivirus fictif.
