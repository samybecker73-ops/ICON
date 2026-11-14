# ICON

ICON est un centre de contrôle PC local, développé avec Electron. Aucun compte utilisateur, aucune inscription et aucune transmission des données système vers un serveur ne sont requis.

## État du dépôt

Les workflows de compilation et de publication sont configurés. L’import initial du code source 0.2.1 doit encore être effectué depuis l’archive **ICON-GITHUB-IMPORT-0.2.1.zip** fournie dans cette conversation.

### Import initial des sources

1. Télécharge et extrais l’archive \`ICON-GITHUB-IMPORT-0.2.1.zip\`.
2. Clone ce dépôt avec GitHub Desktop : https://github.com/samybecker73-ops/ICON
3. Copie le contenu du dossier extrait dans le dossier local du dépôt cloné.
4. Accepte le remplacement de README, .gitignore et .github/workflows.
5. Dans GitHub Desktop, crée un commit nommé \`Import ICON 0.2.1 source\`, puis clique sur **Push origin**.

Après cette étape, le dépôt contiendra le projet Electron complet et les workflows pourront compiler le logiciel.

## Lancer en développement

Prérequis : Node.js 20+ et npm.

\`\`\`powershell
npm install
npm start
\`\`\`

## Construire l’installateur Windows

Depuis la racine du dépôt, double-clique sur \`BUILD-ICON.cmd\`. Le setup est généré dans \`dist/\`.

## Mises à jour automatiques

La version Windows installée intègre \`electron-updater\`. Depuis **Paramètres → Mises à jour**, ICON vérifie les GitHub Releases publiques, propose le téléchargement, puis installe après validation et redémarrage. Aucun compte ni jeton GitHub personnel n’est intégré à l’application.

Le dépôt doit rester public. GitHub Actions utilise uniquement le \`GITHUB_TOKEN\` temporaire avec la permission de publier les releases.

## Publier une version

1. Incrémente \`version\` dans \`package.json\`.
2. Envoie le changement sur \`main\`.
3. Ouvre **Actions → ICON Release → Run workflow** et saisis le tag correspondant, par exemple \`v0.2.2\`.
4. Le workflow vérifie la correspondance entre le tag et la version, construit l’installateur Windows et publie les fichiers d’update dans GitHub Releases.

La première installation de cette génération nécessite d’installer manuellement ICON 0.2.1. Les versions ultérieures pourront être proposées directement depuis l’application.

## Fonctions de la version 0.2.1

- Écran de lancement animé et tableau de bord sombre.
- Mesures CPU et RAM et volumes logiques.
- Inventaire matériel Windows via PowerShell/CIM.
- Export local d’un rapport JSON.
- Visite guidée locale.
- Paramètres et vérification des mises à jour GitHub.

## Limites connues

L’analyse détaillée de l’espace disque, les processus, les éléments cachés, l’antivirus et l’optimisation restent à construire. ICON n’affiche pas de résultat antivirus fictif.
