# Suivi d'Objectifs

Application mobile (Android) pour suivre l'avancement des **tâches** et **objectifs** assignés à une **personne** ou à une **équipe**.

C'est une *Progressive Web App* (PWA) : elle s'installe sur l'écran d'accueil d'un téléphone Android depuis Chrome, s'ouvre en plein écran comme une application classique et **fonctionne sans connexion**.

Deux façons de l'utiliser :

- **Sans compte** : les données restent sur le téléphone. Rien à configurer.
- **En équipe** (synchronisation Firebase) : chaque membre se connecte sur son propre téléphone, voit les objectifs de l'équipe et met à jour ses tâches. Les changements apparaissent en temps réel chez tout le monde.

## Fonctionnalités

- **Objectifs** : intitulé, description, résultat attendu, responsable (personne ou équipe), dates de début et d'échéance.
- **Tâches** rattachées à un objectif : assignation, échéance, priorité, poids dans l'objectif, statut (À faire, En cours, Bloquée, Terminée).
- **Suivi de l'évolution** : chaque mise à jour d'avancement (0 à 100 %) est horodatée avec un commentaire, ce qui donne l'historique de chaque tâche.
- **Courbe d'évolution** de chaque objectif, comparée au rythme prévu entre la date de début et l'échéance.
- **Indicateurs de santé** calculés automatiquement : *En bonne voie*, *À risque*, *En retard*, *Atteint*.
- **Tableau de bord** : objectifs en cours, tâches en retard ou bloquées, avancement par équipe et par personne, activité récente.
- **Personnes et équipes** : une tâche assignée à une équipe compte pour chacun de ses membres.
- Filtres et recherche sur les tâches.
- **Travail en équipe** : comptes, espace de travail partagé, invitation par code, rôles *administrateur* et *membre*, section « Mes tâches », auteur de chaque mise à jour.
- **Export / import** des données (fichier `.json`) pour les sauvegarder ou les transférer sur un autre appareil.
- Thème clair ou sombre selon le réglage du téléphone.

## Installer l'application sur Android

1. Publiez l'application (voir ci-dessous) ou hébergez les fichiers sur n'importe quel site en **HTTPS**.
2. Ouvrez l'adresse dans **Chrome** sur le téléphone.
3. Ouvrez le menu **⋮** puis choisissez **Installer l'application** (ou **Ajouter à l'écran d'accueil**). Le bouton est aussi proposé dans *Réglages* (⚙).
4. L'icône « Objectifs » apparaît sur l'écran d'accueil.

### Publication gratuite avec GitHub Pages

Le workflow `.github/workflows/pages.yml` publie automatiquement l'application à chaque mise à jour de la branche `main` :

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Fusionnez les modifications dans `main`. L'adresse ressemblera à `https://<utilisateur>.github.io/<dépôt>/`.

## Synchronisation entre téléphones (Firebase)

La synchronisation utilise [Firebase](https://firebase.google.com/), le service de Google. L'offre gratuite (Spark) suffit largement pour une équipe de quelques dizaines de personnes. Cette configuration se fait **une seule fois**, par la personne qui publie l'application.

### 1. Créer le projet Firebase

1. Ouvrez la [console Firebase](https://console.firebase.google.com/) et cliquez sur **Créer un projet** (Google Analytics est facultatif).
2. **Authentication** → **Commencer** → onglet **Méthode de connexion** → activez **Adresse e-mail/Mot de passe**.
3. **Firestore Database** → **Créer une base de données** → choisissez un emplacement (par exemple `eur3 (europe-west)`) → **mode production**.
4. Dans Firestore, onglet **Règles** : remplacez le contenu par celui du fichier [`firestore.rules`](firestore.rules), puis **Publier**. *Ne sautez pas cette étape : ce sont ces règles qui protègent les données.*
5. **Paramètres du projet** (⚙) → **Vos applications** → icône **Web `</>`** → donnez un nom → **Enregistrer l'application**. Firebase affiche un bloc `firebaseConfig`.
6. **Authentication** → **Paramètres** → **Domaines autorisés** → ajoutez le domaine où l'application est publiée (par exemple `utilisateur.github.io`).

### 2. Brancher l'application

Ouvrez [`js/config.js`](js/config.js) et remplacez `window.FIREBASE_CONFIG = null;` par les valeurs affichées à l'étape 5 :

```js
window.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'mon-projet.firebaseapp.com',
  projectId: 'mon-projet',
  storageBucket: 'mon-projet.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
```

Ces valeurs ne sont pas secrètes : elles peuvent être publiées. L'accès aux données est contrôlé par les règles de sécurité et par les comptes.

Publiez ensuite la modification (fusion dans `main`, voir plus haut). Pour que les téléphones déjà installés prennent la nouvelle version, l'application doit être rouverte une fois avec une connexion Internet.

### 3. Utilisation en équipe

**L'administrateur (vous) :**

1. *Réglages* (⚙) → **Activer la synchronisation** → **Créer un compte**.
2. **Créer un espace de travail** (par exemple « Société ABC »). Cochez la case pour y copier les données déjà saisies sur le téléphone.
3. *Réglages* → **Partager l'invitation** : le lien de l'application et le code d'invitation partent par WhatsApp, SMS ou e-mail.
4. Après l'arrivée de chaque membre : onglet *Équipe* → sa fiche → **Modifier** → **Compte lié**. Ses tâches apparaissent alors dans « Mes tâches » sur son téléphone.

**Chaque membre :**

1. Ouvre le lien dans Chrome et installe l'application.
2. *Réglages* → **Activer la synchronisation** → **Créer un compte**.
3. Saisit le **code d'invitation** reçu.
4. Met à jour ses tâches : **Mettre à jour l'avancement**, avec un commentaire.

### Droits de chacun

| | Administrateur | Membre |
| --- | :---: | :---: |
| Voir les objectifs, tâches, l'équipe et le tableau de bord | ✅ | ✅ |
| Mettre à jour l'avancement et le statut d'une tâche | ✅ | ✅ |
| Créer, modifier ou supprimer des objectifs et des tâches | ✅ | ❌ |
| Gérer les personnes, les équipes et les membres | ✅ | ❌ |
| Nommer d'autres administrateurs, renouveler le code | ✅ | ❌ |

Ces droits sont appliqués **par le serveur** (fichier `firestore.rules`), et pas seulement masqués dans l'application. Chaque mise à jour d'avancement garde le nom de son auteur.

Hors connexion, l'application reste utilisable : les modifications sont envoyées automatiquement au retour du réseau. Un compte peut appartenir à plusieurs espaces de travail.

## Prise en main

1. Onglet **Équipe** : ajoutez les personnes, puis regroupez-les en équipes.
2. Onglet **Objectifs** : créez un objectif et désignez un responsable.
3. Dans l'objectif, ajoutez les **tâches** et assignez-les.
4. Au fil du temps, ouvrez une tâche et touchez **Mettre à jour l'avancement**.
5. Suivez l'ensemble depuis le **Tableau** de bord.

Pour découvrir l'application, utilisez **Voir un exemple** à l'écran d'accueil (ou *Réglages → Charger un exemple*).

## Règles de calcul

- L'avancement d'un objectif est la **moyenne de l'avancement de ses tâches, pondérée par leur poids**. Une tâche terminée compte pour 100 %.
- Un objectif est **à risque** s'il contient une tâche bloquée ou en retard, ou si son avancement a plus de 20 points de retard sur le rythme prévu.
- Il est **en retard** si son échéance est dépassée sans atteindre 100 %.

## Développement

L'application est en HTML, CSS et JavaScript, sans étape de compilation. Le SDK Firebase est fourni pré-assemblé dans `js/vendor/firebase.js`. Il n'est chargé que si la synchronisation est activée.

```bash
npm install
npm start                 # http://localhost:8080
npm run test:rules        # tests des règles de sécurité (émulateur Firestore, nécessite Java)
npm run emulators         # émulateurs Auth + Firestore pour tester sans vrai projet
npm run build:firebase    # régénère js/vendor/firebase.js après une mise à jour de Firebase
```

Pour tester la synchronisation sur les émulateurs, mettez dans `js/config.js` :
`window.FIREBASE_CONFIG = { apiKey: 'demo', projectId: 'demo-suivi', authDomain: 'localhost', appId: 'demo', emulator: { host: '127.0.0.1' } };`

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page |
| `css/styles.css` | Styles (mobile d'abord, thème clair et sombre) |
| `js/app.js` | Logique, vues, formulaires, stockage local |
| `js/config.js` | Configuration Firebase (`null` = sans compte) |
| `js/cloud.js` | Synchronisation : comptes, espaces de travail, temps réel |
| `js/vendor/firebase.js` | SDK Firebase assemblé (`npm run build:firebase`) |
| `firestore.rules` | Règles de sécurité de la base de données |
| `tests/rules.test.mjs` | Tests des règles de sécurité |
| `manifest.webmanifest` | Métadonnées d'installation (nom, icônes, couleurs) |
| `sw.js` | Service worker : fonctionnement hors ligne |
| `icons/` | Icônes de l'application |

Après une modification de fichiers, incrémentez `CACHE` dans `sw.js` pour que les téléphones récupèrent la nouvelle version.

## Évolutions possibles

- Notifications de rappel avant les échéances.
- Publication sur le Play Store sous forme d'APK (via Capacitor ou une *Trusted Web Activity*).
