// Tests des règles de sécurité Firestore (firestore.rules).
// Lancer avec : npm run test:rules   (démarre l'émulateur Firestore automatiquement)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env;
const WID = 'ws1';
const CODE = 'ABCD2345';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-suivi',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8081 },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WID), { name: 'ABC', createdBy: 'admin', inviteCode: CODE });
    await setDoc(doc(db, 'workspaces', WID, 'members', 'admin'), { uid: 'admin', role: 'admin' });
    await setDoc(doc(db, 'workspaces', WID, 'members', 'membre'), { uid: 'membre', role: 'membre' });
    await setDoc(doc(db, 'invites', CODE), { workspaceId: WID, name: 'ABC' });
    await setDoc(doc(db, 'workspaces', WID, 'objectives', 'o1'), { title: 'Objectif' });
    await setDoc(doc(db, 'workspaces', WID, 'tasks', 't1'), { title: 'Tâche', objectiveId: 'o1', progress: 0, status: 'todo', history: [] });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const task = (db) => doc(db, 'workspaces', WID, 'tasks', 't1');

test('un visiteur non connecté ne lit rien', async () => {
  await assertFails(getDoc(doc(anon(), 'workspaces', WID)));
  await assertFails(getDoc(doc(anon(), 'invites', CODE)));
});

test("un utilisateur étranger à l'espace ne lit ni n'écrit rien", async () => {
  const db = as('intrus');
  await assertFails(getDoc(doc(db, 'workspaces', WID)));
  await assertFails(getDocs(collection(db, 'workspaces', WID, 'tasks')));
  await assertFails(setDoc(doc(db, 'workspaces', WID, 'objectives', 'x'), { title: 'Piratage' }));
});

test('un membre lit toutes les données de son espace', async () => {
  const db = as('membre');
  await assertSucceeds(getDoc(doc(db, 'workspaces', WID)));
  await assertSucceeds(getDocs(collection(db, 'workspaces', WID, 'objectives')));
  await assertSucceeds(getDocs(collection(db, 'workspaces', WID, 'members')));
});

test("un membre met à jour l'avancement d'une tâche", async () => {
  await assertSucceeds(updateDoc(task(as('membre')), {
    progress: 50, status: 'doing', updatedAt: 'x', history: [{ progress: 50, status: 'doing' }],
  }));
});

test('un membre ne modifie pas le reste de la tâche, ni les objectifs', async () => {
  const db = as('membre');
  await assertFails(updateDoc(task(db), { title: 'Autre titre' }));
  await assertFails(updateDoc(task(db), { progress: 80, assignee: { type: 'person', id: 'moi' } }));
  await assertFails(deleteDoc(task(db)));
  await assertFails(setDoc(doc(db, 'workspaces', WID, 'tasks', 't2'), { title: 'Nouvelle' }));
  await assertFails(updateDoc(doc(db, 'workspaces', WID, 'objectives', 'o1'), { title: 'Modifié' }));
});

test('un membre ne peut pas se promouvoir administrateur', async () => {
  const db = as('membre');
  await assertFails(updateDoc(doc(db, 'workspaces', WID, 'members', 'membre'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'workspaces', WID), { createdBy: 'membre' }));
});

test("l'administrateur gère toutes les données et les rôles", async () => {
  const db = as('admin');
  await assertSucceeds(setDoc(doc(db, 'workspaces', WID, 'tasks', 't2'), { title: 'Nouvelle' }));
  await assertSucceeds(updateDoc(task(db), { title: 'Renommée' }));
  await assertSucceeds(deleteDoc(doc(db, 'workspaces', WID, 'objectives', 'o1')));
  await assertSucceeds(updateDoc(doc(db, 'workspaces', WID, 'members', 'membre'), { uid: 'membre', role: 'admin' }));
  await assertSucceeds(deleteDoc(doc(db, 'workspaces', WID, 'members', 'membre')));
});

test('rejoindre un espace exige un code valide, et seulement comme membre', async () => {
  const db = as('nouveau');
  const me = doc(db, 'workspaces', WID, 'members', 'nouveau');
  await assertFails(setDoc(me, { uid: 'nouveau', role: 'membre', code: 'FAUXCODE' }));
  await assertFails(setDoc(me, { uid: 'nouveau', role: 'admin', code: CODE }));
  await assertFails(setDoc(doc(db, 'workspaces', WID, 'members', 'autre'), { uid: 'autre', role: 'membre', code: CODE }));
  await assertSucceeds(getDoc(doc(db, 'invites', CODE)));
  await assertSucceeds(setDoc(me, { uid: 'nouveau', role: 'membre', code: CODE }));
  await assertSucceeds(getDocs(collection(db, 'workspaces', WID, 'tasks')));
});

test("créer son propre espace et s'en déclarer administrateur", async () => {
  const db = as('createur');
  await assertFails(setDoc(doc(db, 'workspaces', 'ws2'), { name: 'X', createdBy: 'quelquun' }));
  await assertSucceeds(setDoc(doc(db, 'workspaces', 'ws2'), { name: 'Mon espace', createdBy: 'createur' }));
  await assertSucceeds(setDoc(doc(db, 'workspaces', 'ws2', 'members', 'createur'), { uid: 'createur', role: 'admin' }));
  // Impossible de se déclarer administrateur de l'espace de quelqu'un d'autre.
  await assertFails(setDoc(doc(db, 'workspaces', WID, 'members', 'createur'), { uid: 'createur', role: 'admin' }));
});

test('un membre peut quitter un espace ; un profil utilisateur est privé', async () => {
  await assertSucceeds(deleteDoc(doc(as('membre'), 'workspaces', WID, 'members', 'membre')));
  await assertSucceeds(setDoc(doc(as('membre'), 'users', 'membre'), { workspaces: {} }));
  await assertFails(getDoc(doc(as('intrus'), 'users', 'membre')));
});
