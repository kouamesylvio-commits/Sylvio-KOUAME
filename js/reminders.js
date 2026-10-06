/* Rappels d'échéance — code partagé entre l'application (window) et le service worker (importScripts).
 *
 * L'application enregistre un « résumé » des tâches à surveiller dans le cache du navigateur ; le service
 * worker le relit pour afficher les notifications, y compris en arrière-plan (Periodic Background Sync),
 * sans avoir accès aux données de l'application.
 */
(function (root) {
  'use strict';

  const CACHE = 'suivi-rappels';
  const PERIODIC_TAG = 'rappels';
  const MAX_SEPARATE = 3; // au-delà, une seule notification récapitulative
  const KEEP_DAYS = 45;   // durée de conservation des rappels déjà envoyés

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysUntil = (due, today) => Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
  const shortDate = (s) => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const url = (name) => new URL(name, root.registration ? root.registration.scope : document.baseURI).href;

  /**
   * Rappels à envoyer aujourd'hui.
   * digest = { enabled, leadDays, late, tasks: [{ id, title, dueDate, objective }] }
   * Chaque rappel a une clé unique : « bientôt » et « aujourd'hui » une seule fois par échéance,
   * « en retard » au plus une fois par jour.
   */
  function compute(digest, today, alreadySent) {
    const items = [];
    if (!digest || !digest.enabled) return items;
    for (const t of digest.tasks || []) {
      if (!t.dueDate) continue;
      const n = daysUntil(t.dueDate, today);
      let key, body;
      if (n < 0) {
        if (!digest.late) continue;
        key = `${t.id}:late:${today}`;
        body = `En retard de ${plural(-n, 'jour', 'jours')} (échéance le ${shortDate(t.dueDate)})`;
      } else if (n === 0) {
        key = `${t.id}:today:${t.dueDate}`;
        body = "Échéance aujourd'hui";
      } else if (n <= (digest.leadDays || 0)) {
        key = `${t.id}:soon:${t.dueDate}`;
        body = n === 1 ? 'Échéance demain' : `Échéance dans ${n} jours (${shortDate(t.dueDate)})`;
      } else {
        continue;
      }
      if (alreadySent && alreadySent[key]) continue;
      items.push({ key, id: t.id, title: t.title, body: t.objective ? `${body} · ${t.objective}` : body, late: n < 0 });
    }
    return items.sort((a, b) => b.late - a.late);
  }

  async function readJSON(cache, name, fallback) {
    try {
      const res = await cache.match(url(name));
      return res ? await res.json() : fallback;
    } catch (e) {
      return fallback;
    }
  }
  const writeJSON = (cache, name, value) =>
    cache.put(url(name), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));

  /** Côté application : enregistre le résumé des tâches à surveiller. */
  async function saveDigest(digest) {
    const cache = await caches.open(CACHE);
    await writeJSON(cache, '__rappels.json', digest);
  }

  /** Côté service worker : affiche les rappels dus et retient ceux déjà envoyés. Renvoie leur nombre. */
  async function notify(registration) {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return 0;
    const cache = await caches.open(CACHE);
    const digest = await readJSON(cache, '__rappels.json', null);
    const today = isoDay(new Date());
    const sent = await readJSON(cache, '__rappels-envoyes.json', {});
    const items = compute(digest, today, sent);
    if (!items.length) return 0;

    const icon = url('icons/icon-192.png');
    if (items.length <= MAX_SEPARATE) {
      for (const it of items) {
        await registration.showNotification(`${it.late ? '⚠️ ' : '⏰ '}${it.title}`, {
          body: it.body, icon, badge: icon, tag: `rappel-${it.id}`, data: { hash: `#/tache/${it.id}` },
        });
      }
    } else {
      const late = items.filter((i) => i.late).length;
      await registration.showNotification(`⏰ ${plural(items.length, 'tâche demande', 'tâches demandent')} votre attention`, {
        body: `${late ? `${late} en retard. ` : ''}${items.slice(0, 4).map((i) => i.title).join(' · ')}${items.length > 4 ? '…' : ''}`,
        icon, badge: icon, tag: 'rappels', data: { hash: '#/taches' },
      });
    }

    const limit = isoDay(new Date(Date.now() - KEEP_DAYS * 864e5));
    for (const [k, d] of Object.entries(sent)) if (d < limit) delete sent[k];
    for (const it of items) sent[it.key] = today;
    await writeJSON(cache, '__rappels-envoyes.json', sent);
    return items.length;
  }

  root.Rappels = { CACHE, PERIODIC_TAG, compute, saveDigest, notify, isoDay };
})(self);
