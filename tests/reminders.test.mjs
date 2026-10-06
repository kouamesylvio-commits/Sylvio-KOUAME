// Tests du calcul des rappels d'échéance (js/reminders.js). Lancer avec : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sandbox = { self: { registration: { scope: 'http://localhost/' } }, URL, Response: globalThis.Response };
vm.runInNewContext(readFileSync(new URL('../js/reminders.js', import.meta.url), 'utf8'), sandbox);
// Le code s'exécute dans un autre contexte : on recopie les résultats pour pouvoir les comparer.
const compute = (...args) => JSON.parse(JSON.stringify(sandbox.self.Rappels.compute(...args)));

const TODAY = '2026-10-05';
const task = (id, dueDate) => ({ id, title: `Tâche ${id}`, dueDate, objective: 'Objectif' });
const digest = (tasks, opts = {}) => ({ enabled: true, leadDays: 2, late: true, tasks, ...opts });
const ids = (items) => items.map((i) => i.id);

test("rien n'est envoyé si les rappels sont désactivés", () => {
  assert.deepEqual(compute(digest([task('a', TODAY)], { enabled: false }), TODAY, {}), []);
  assert.deepEqual(compute(null, TODAY, {}), []);
});

test("échéance du jour, proche, lointaine et sans date", () => {
  const items = compute(digest([task('jour', TODAY), task('demain', '2026-10-06'), task('j2', '2026-10-07'),
    task('j3', '2026-10-08'), { id: 'sansdate', title: 'x' }]), TODAY, {});
  assert.deepEqual(ids(items).sort(), ['demain', 'j2', 'jour']);
  assert.match(items.find((i) => i.id === 'jour').body, /aujourd'hui/);
  assert.match(items.find((i) => i.id === 'demain').body, /demain/);
  assert.match(items.find((i) => i.id === 'j2').body, /dans 2 jours/);
});

test('le délai de prévenance est respecté', () => {
  assert.deepEqual(ids(compute(digest([task('j3', '2026-10-08')], { leadDays: 3 }), TODAY, {})), ['j3']);
  assert.deepEqual(ids(compute(digest([task('j3', '2026-10-08')], { leadDays: 1 }), TODAY, {})), []);
});

test('les tâches en retard passent en premier, et peuvent être exclues', () => {
  const tasks = [task('jour', TODAY), task('retard', '2026-10-01')];
  const items = compute(digest(tasks), TODAY, {});
  assert.deepEqual(ids(items), ['retard', 'jour']);
  assert.match(items[0].body, /En retard de 4 jours/);
  assert.deepEqual(ids(compute(digest(tasks, { late: false }), TODAY, {})), ['jour']);
});

test("un rappel déjà envoyé n'est pas répété ; un retard est rappelé une fois par jour", () => {
  const d = digest([task('proche', '2026-10-06'), task('retard', '2026-10-01')]);
  const sent = Object.fromEntries(compute(d, TODAY, {}).map((i) => [i.key, TODAY]));
  assert.deepEqual(compute(d, TODAY, sent), []);
  // Le lendemain : la tâche « proche » arrive à échéance (nouveau rappel), le retard est rappelé à nouveau.
  const next = compute(d, '2026-10-06', sent);
  assert.deepEqual(ids(next).sort(), ['proche', 'retard']);
  assert.match(next.find((i) => i.id === 'proche').body, /aujourd'hui/);
});

test("un report d'échéance déclenche un nouveau rappel", () => {
  const sent = Object.fromEntries(compute(digest([task('a', '2026-10-06')]), TODAY, {}).map((i) => [i.key, TODAY]));
  assert.deepEqual(ids(compute(digest([task('a', '2026-10-07')]), TODAY, sent)), ['a']);
});
