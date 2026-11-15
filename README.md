# ICON — chantier de diagnostic local

ICON est un centre de contrôle PC local développé avec Electron. Aucun compte utilisateur ni inscription n'est requis. Les analyses de dossiers sont déclenchées par l'utilisateur ; elles restent locales jusqu'à un export manuel.

## Modules du chantier

- **Accueil et ressources :** utilisation CPU, RAM, volumes locaux et actualisation automatique.
- **Inventaire matériel :** système Windows, CPU, GPU, mémoire, carte mère, BIOS, disques physiques, interfaces et écrans.
- **Analyse disque :** sélection d'un dossier, mesure récursive en lecture seule, poids des dossiers principaux, extensions et 20 fichiers les plus lourds.
- **Processus :** liste des processus, PID, mémoire, CPU cumulée, threads, handles et recherche.
- **Sécurité :** informations réellement retournées par Microsoft Defender et le pare-feu Windows, signatures et dates d'analyse disponibles. Possibilité de demander explicitement une analyse rapide à Defender.
- **Éléments cachés :** fichiers et dossiers marqués Hidden par Windows ou dont le nom commence par un point, dans un dossier choisi.
- **Applications :** programmes déclarés dans les clés de désinstallation Windows.
- **Démarrage :** commandes et applications configurées pour démarrer avec la session.
- **Réseau :** interfaces, profils, IPv4, passerelles et DNS, sans lecture des mots de passe Wi-Fi.
- **Outils système :** accès direct aux utilitaires et réglages Windows officiels.

## Sécurité et limites

Les inventaires et analyses de dossiers sont en lecture seule. ICON ne supprime aucun fichier, ne désactive aucune application et ne termine aucun processus. Les changements système restent sous le contrôle de Windows et de l'utilisateur.

ICON n'est pas un antivirus autonome. Le module Sécurité affiche uniquement les informations retournées par Windows. Une analyse rapide est demandée à Microsoft Defender et son résultat doit être suivi dans Sécurité Windows. Une donnée inconnue ou indisponible n'est jamais présentée comme une protection active.

L'analyse disque est limitée au dossier sélectionné, à 200 000 entrées et à 24 niveaux pour protéger la réactivité. Les liens symboliques sont ignorés. Windows peut refuser l'accès à des éléments ; ils sont comptabilisés comme ignorés. Les résultats de l'analyse des éléments cachés sont limités à 500 lignes affichées.

Les inventaires détaillés (processus, programmes installés, Defender, réseau et démarrage) dépendent des informations fournies par Windows ; certains champs peuvent rester indisponibles.

## Développement local

Prérequis : Node.js 20+ et npm.

```powershell
npm install
npm test
npm start
```

## Communauté Discord

Un accès permanent **Rejoindre Discord** est disponible dans la barre latérale de l’application. Il ouvre l’invitation du serveur dans le navigateur par défaut : https://discord.gg/fKgFP82Jm. Le lien est géré côté processus principal Electron et n’accepte pas d’adresse fournie par l’interface.

## Télécharger ICON pour Windows

Deux formats sont prévus dans chaque publication GitHub :

- **ICON-Setup-version.exe** : installateur classique, avec choix du dossier et raccourcis Windows. Cette version conserve les mises à jour automatiques intégrées.
- **ICON.exe** : version portable en un seul exécutable, sans assistant d'installation. Il suffit de télécharger le fichier et de le lancer. Cette version ne lance pas le service d'auto-update : pour la mettre à jour, télécharge la nouvelle version publiée sur GitHub.

Le fichier portable est un vrai build `portable` electron-builder ; ce n'est pas l'exécutable interne extrait de `win-unpacked`.

## Construire les versions Windows

Double-clique sur `BUILD-ICON.cmd`. Le script installe les dépendances, exécute les tests puis construit l'installateur et le fichier portable dans `dist/` (`ICON-Setup-version.exe` et `ICON.exe`).

Pour construire uniquement le portable : `npm run build:win:portable`.

**La compilation ne publie rien sur GitHub.** Les commandes de build utilisent explicitement `--publish never`. La publication est une opération distincte, réservée à la branche `main`, et ne sera faite qu'après validation et demande explicite.

## Organisation du dépôt

- `main` reste la branche de référence et contient la dernière version publiée.
- `work/icon-deep-upgrade` est la branche de préparation de ce chantier.
- Les branches `work/*` exécutent les tests et la compilation sans déclencher une Release.
- Le workflow de publication n'accepte que la branche `main`.
