/* Synchronisation en ligne (Firebase) : comptes, espaces de travail partagés et données en temps réel.
 *
 * Structure Firestore :
 *   users/{uid}                          profil : { email, workspaces: { wid: nom }, current }
 *   invites/{code}                       { workspaceId, name }
 *   workspaces/{wid}                     { name, createdBy, inviteCode }
 *   workspaces/{wid}/members/{uid}       { uid, email, displayName, role: 'admin' | 'membre' }
 *   workspaces/{wid}/{people|teams|objectives|tasks}/{id}
 */
import {
  initializeApp, getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut,
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, arrayUnion, deleteField, serverTimestamp,
} from './vendor/firebase.js';

const COLLECTIONS = ['people', 'teams', 'objectives', 'tasks'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BATCH = 450;

const ERRORS = {
  'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'Adresse e-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'Aucun compte ne correspond à cette adresse e-mail.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse e-mail.',
  'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
  'auth/invalid-email': "L'adresse e-mail n'est pas valide.",
  'auth/missing-password': 'Saisissez votre mot de passe.',
  'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion Internet.',
  'permission-denied': "Vous n'avez pas les droits pour effectuer cette action.",
  unavailable: 'Serveur injoignable : vérifiez votre connexion Internet.',
};
export const errorMessage = (e) => ERRORS[e?.code] || e?.message || 'Une erreur est survenue.';

const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Démarre la synchronisation.
 * hooks.setData(collection, documents) — remplace une collection de l'état local
 * hooks.changed()                      — l'état (données ou statut) a changé : réafficher
 * hooks.toast(message)                 — message à l'utilisateur
 */
export function startCloud(config, hooks) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  if (config.emulator) {
    connectAuthEmulator(auth, `http://${config.emulator.host || 'localhost'}:${config.emulator.authPort || 9099}`, { disableWarnings: true });
    connectFirestoreEmulator(db, config.emulator.host || 'localhost', config.emulator.firestorePort || 8081);
  }

  const cloud = {
    status: 'loading', // loading | signedOut | noWorkspace | ready
    user: null,
    profile: { workspaces: {} },
    workspace: null,
    role: null,
    members: [],
    get isAdmin() { return this.role === 'admin'; },
  };

  let profileUnsub = null;
  let wsUnsubs = [];
  let synced = {}; // dernière version connue de chaque document, par collection
  let openedId = null;

  const changed = () => hooks.changed();
  const uid = () => auth.currentUser?.uid;
  const userRef = () => doc(db, 'users', uid());
  const memberRef = (wid, u = uid()) => doc(db, 'workspaces', wid, 'members', u);
  const displayName = () => auth.currentUser?.displayName || auth.currentUser?.email || 'Utilisateur';

  function closeWorkspace() {
    wsUnsubs.forEach((u) => u());
    wsUnsubs = [];
    openedId = null;
    cloud.workspace = null;
    cloud.role = null;
    cloud.members = [];
    synced = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
    for (const c of COLLECTIONS) hooks.setData(c, []);
  }

  function lostAccess(wid) {
    if (openedId !== wid) return;
    closeWorkspace();
    cloud.status = 'noWorkspace';
    updateDoc(userRef(), { [`workspaces.${wid}`]: deleteField(), current: deleteField() }).catch(() => {});
    hooks.toast("Vous n'avez plus accès à cet espace de travail.");
    changed();
  }

  function openWorkspace(wid) {
    if (openedId === wid) return;
    closeWorkspace();
    openedId = wid;
    cloud.status = 'loading';
    changed();
    const pending = new Set(['workspace', 'members', ...COLLECTIONS]);
    const loaded = (key) => {
      pending.delete(key);
      if (!pending.size && cloud.role && openedId === wid) { cloud.status = 'ready'; }
      changed();
    };
    const fail = (e) => (e.code === 'permission-denied' ? lostAccess(wid) : hooks.toast(errorMessage(e)));

    wsUnsubs.push(onSnapshot(doc(db, 'workspaces', wid), (snap) => {
      if (!snap.exists()) return snap.metadata.fromCache ? null : lostAccess(wid);
      cloud.workspace = { id: wid, ...snap.data() };
      loaded('workspace');
    }, fail));

    wsUnsubs.push(onSnapshot(collection(db, 'workspaces', wid, 'members'), (snap) => {
      cloud.members = snap.docs.map((d) => d.data()).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'fr'));
      const me = cloud.members.find((m) => m.uid === uid());
      if (!me) return snap.metadata.fromCache ? null : lostAccess(wid);
      cloud.role = me.role;
      loaded('members');
    }, fail));

    for (const c of COLLECTIONS) {
      wsUnsubs.push(onSnapshot(collection(db, 'workspaces', wid, c), (snap) => {
        const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        synced[c] = new Map(docs.map((d) => [d.id, clone(d)]));
        hooks.setData(c, docs);
        loaded(c);
      }, fail));
    }
  }

  onAuthStateChanged(auth, (user) => {
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    closeWorkspace();
    cloud.user = user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null;
    if (!user) { cloud.status = 'signedOut'; changed(); return; }
    cloud.status = 'loading';
    changed();
    profileUnsub = onSnapshot(userRef(), (snap) => {
      cloud.profile = snap.exists() ? snap.data() : { workspaces: {} };
      cloud.profile.workspaces ||= {};
      const wid = cloud.profile.current;
      if (wid && cloud.profile.workspaces[wid]) openWorkspace(wid);
      else if (!snap.metadata.fromCache || snap.exists()) {
        if (openedId) closeWorkspace();
        cloud.status = 'noWorkspace';
        changed();
      }
    }, (e) => hooks.toast(errorMessage(e)));
  });

  // ---------------- Envoi des modifications locales ----------------

  /** Compare l'état local à la dernière version synchronisée et n'envoie que les champs modifiés. */
  cloud.push = (state) => {
    if (cloud.status !== 'ready' || !openedId) return;
    const wid = openedId;
    const ops = [];
    for (const c of COLLECTIONS) {
      const prev = synced[c] || new Map();
      const seen = new Set();
      for (const item of state[c]) {
        seen.add(item.id);
        const { id, ...data } = clone(item);
        const ref = doc(db, 'workspaces', wid, c, id);
        const old = prev.get(id);
        if (!old) {
          ops.push((b) => b.set(ref, data));
        } else {
          const upd = {};
          for (const k of new Set([...Object.keys(data), ...Object.keys(old)])) {
            if (k === 'id' || same(old[k], data[k])) continue;
            if (k === 'history' && Array.isArray(old.history) && Array.isArray(data.history)
              && data.history.length > old.history.length && same(old.history, data.history.slice(0, old.history.length))) {
              // Ajout à l'historique : arrayUnion évite d'écraser les mises à jour simultanées d'un autre membre.
              upd.history = arrayUnion(...data.history.slice(old.history.length));
            } else {
              upd[k] = k in data ? data[k] : deleteField();
            }
          }
          if (Object.keys(upd).length) ops.push((b) => b.update(ref, upd));
        }
        prev.set(id, { ...data, id });
      }
      for (const id of [...prev.keys()]) {
        if (!seen.has(id)) { ops.push((b) => b.delete(doc(db, 'workspaces', wid, c, id))); prev.delete(id); }
      }
      synced[c] = prev;
    }
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
      const batch = writeBatch(db);
      ops.slice(i, i + MAX_BATCH).forEach((op) => op(batch));
      // Pas d'attente : hors connexion, l'envoi est mis en file d'attente et se fera au retour du réseau.
      batch.commit().catch((e) => hooks.toast(errorMessage(e)));
    }
  };

  // ---------------- Compte ----------------

  cloud.signIn = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password);
  cloud.signUp = async (name, email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    cloud.user = { uid: cred.user.uid, email: cred.user.email, displayName: name.trim() };
    changed();
  };
  cloud.resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
  cloud.signOut = () => signOut(auth);

  // ---------------- Espaces de travail ----------------

  async function addToProfile(wid, name) {
    await setDoc(userRef(), { email: auth.currentUser.email, workspaces: { [wid]: name }, current: wid }, { merge: true });
  }

  cloud.createWorkspace = async (name, initialData) => {
    const wid = doc(collection(db, 'workspaces')).id;
    const code = newCode();
    await setDoc(doc(db, 'workspaces', wid), { name, createdBy: uid(), createdAt: serverTimestamp(), inviteCode: code });
    await setDoc(memberRef(wid), { uid: uid(), email: auth.currentUser.email, displayName: displayName(), role: 'admin', joinedAt: serverTimestamp() });
    await setDoc(doc(db, 'invites', code), { workspaceId: wid, name });
    if (initialData) {
      const batches = [];
      let batch = writeBatch(db), n = 0;
      for (const c of COLLECTIONS) {
        for (const { id, ...data } of clone(initialData[c] || [])) {
          batch.set(doc(db, 'workspaces', wid, c, id), data);
          if (++n % MAX_BATCH === 0) { batches.push(batch); batch = writeBatch(db); }
        }
      }
      batches.push(batch);
      await Promise.all(batches.map((b) => b.commit()));
    }
    await addToProfile(wid, name);
  };

  cloud.joinWorkspace = async (rawCode) => {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const invite = await getDoc(doc(db, 'invites', code));
    if (!invite.exists()) throw new Error("Ce code d'invitation n'existe pas ou n'est plus valide.");
    const { workspaceId: wid, name } = invite.data();
    let already = false;
    try { already = (await getDoc(memberRef(wid))).exists(); } catch (e) { /* pas encore membre */ }
    if (!already) {
      await setDoc(memberRef(wid), { uid: uid(), email: auth.currentUser.email, displayName: displayName(), role: 'membre', code, joinedAt: serverTimestamp() });
    }
    await addToProfile(wid, name);
    return name;
  };

  cloud.switchWorkspace = (wid) => updateDoc(userRef(), { current: wid });

  cloud.leaveWorkspace = async () => {
    const wid = openedId;
    if (cloud.isAdmin && cloud.members.filter((m) => m.role === 'admin').length < 2 && cloud.members.length > 1) {
      throw new Error("Nommez d'abord un autre administrateur avant de quitter l'espace.");
    }
    closeWorkspace();
    await deleteDoc(memberRef(wid));
    await updateDoc(userRef(), { [`workspaces.${wid}`]: deleteField(), current: deleteField() });
  };

  cloud.setMemberRole = (memberUid, role) => updateDoc(memberRef(openedId, memberUid), { role });
  cloud.removeMember = (memberUid) => deleteDoc(memberRef(openedId, memberUid));

  cloud.renameWorkspace = async (name) => {
    await updateDoc(doc(db, 'workspaces', openedId), { name });
    await addToProfile(openedId, name);
  };

  cloud.regenerateInvite = async () => {
    const old = cloud.workspace.inviteCode;
    const code = newCode();
    await setDoc(doc(db, 'invites', code), { workspaceId: openedId, name: cloud.workspace.name });
    await updateDoc(doc(db, 'workspaces', openedId), { inviteCode: code });
    if (old) await deleteDoc(doc(db, 'invites', old)).catch(() => {});
  };

  return cloud;
}
