/* Configuration de la synchronisation entre téléphones (Firebase).
 *
 * Laissez `null` pour utiliser l'application sans compte : les données restent sur l'appareil.
 * Pour activer le travail en équipe, remplacez `null` par la configuration de votre projet Firebase
 * (console Firebase → Paramètres du projet → Vos applications → Application Web), par exemple :
 *
 * window.FIREBASE_CONFIG = {
 *   apiKey: 'AIza...',
 *   authDomain: 'mon-projet.firebaseapp.com',
 *   projectId: 'mon-projet',
 *   storageBucket: 'mon-projet.firebasestorage.app',
 *   messagingSenderId: '1234567890',
 *   appId: '1:1234567890:web:abcdef',
 * };
 *
 * Ces valeurs ne sont pas secrètes : l'accès aux données est protégé par les règles de firestore.rules.
 */
window.FIREBASE_CONFIG = null;
