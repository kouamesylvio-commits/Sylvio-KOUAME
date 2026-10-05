# Suivi d'Objectifs

Application mobile (Android) pour suivre l'avancement des **tâches** et **objectifs** assignés à une **personne** ou à une **équipe**.

C'est une *Progressive Web App* (PWA) : elle s'installe sur l'écran d'accueil d'un téléphone Android depuis Chrome, s'ouvre en plein écran comme une application classique et **fonctionne sans connexion**. Aucun serveur ni compte n'est nécessaire : les données sont enregistrées sur le téléphone.

## Fonctionnalités

- **Objectifs** : intitulé, description, résultat attendu, responsable (personne ou équipe), dates de début et d'échéance.
- **Tâches** rattachées à un objectif : assignation, échéance, priorité, poids dans l'objectif, statut (À faire, En cours, Bloquée, Terminée).
- **Suivi de l'évolution** : chaque mise à jour d'avancement (0 à 100 %) est horodatée avec un commentaire, ce qui donne l'historique de chaque tâche.
- **Courbe d'évolution** de chaque objectif, comparée au rythme prévu entre la date de début et l'échéance.
- **Indicateurs de santé** calculés automatiquement : *En bonne voie*, *À risque*, *En retard*, *Atteint*.
- **Tableau de bord** : objectifs en cours, tâches en retard ou bloquées, avancement par équipe et par personne, activité récente.
- **Personnes et équipes** : une tâche assignée à une équipe compte pour chacun de ses membres.
- Filtres et recherche sur les tâches.
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

Il n'y a aucune dépendance ni étape de compilation : du HTML, du CSS et du JavaScript.

```bash
npx http-server -p 8080   # puis ouvrir http://localhost:8080
```

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page |
| `css/styles.css` | Styles (mobile d'abord, thème clair et sombre) |
| `js/app.js` | Logique, vues, formulaires, stockage local |
| `manifest.webmanifest` | Métadonnées d'installation (nom, icônes, couleurs) |
| `sw.js` | Service worker : fonctionnement hors ligne |
| `icons/` | Icônes de l'application |

Après une modification de fichiers, incrémentez `CACHE` dans `sw.js` pour que les téléphones récupèrent la nouvelle version.

## Évolutions possibles

- Synchronisation entre plusieurs téléphones (backend type Firebase ou Supabase) pour que chaque membre mette à jour ses propres tâches.
- Notifications de rappel avant les échéances.
- Publication sur le Play Store sous forme d'APK (via Capacitor ou une *Trusted Web Activity*).
