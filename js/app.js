/* Suivi d'Objectifs — application de suivi des tâches et objectifs (PWA hors ligne). */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Constantes & utilitaires
  // ------------------------------------------------------------------
  const STORAGE_KEY = 'suivi-objectifs:v1';
  const STATUS = { todo: 'À faire', doing: 'En cours', blocked: 'Bloquée', done: 'Terminée' };
  const PRIORITY = { low: 'Basse', normal: 'Normale', high: 'Haute' };
  const HEALTH = { ok: 'En bonne voie', risk: 'À risque', late: 'En retard', done: 'Atteint', empty: 'Sans tâche' };
  const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (n, min = 0, max = 100) => Math.min(max, Math.max(min, Number(n) || 0));
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const fmtDate = (s) => {
    if (!s) return '—';
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtDateTime = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  // ------------------------------------------------------------------
  // Stockage
  // ------------------------------------------------------------------
  const emptyState = () => ({ version: 1, people: [], teams: [], objectives: [], tasks: [] });

  function normalize(data) {
    const s = emptyState();
    for (const k of ['people', 'teams', 'objectives', 'tasks']) if (Array.isArray(data?.[k])) s[k] = data[k];
    for (const t of s.teams) t.memberIds = Array.isArray(t.memberIds) ? t.memberIds : [];
    for (const t of s.tasks) {
      t.history = Array.isArray(t.history) ? t.history : [];
      t.weight = clamp(t.weight || 1, 1, 10);
      t.progress = clamp(t.progress);
      t.status = STATUS[t.status] ? t.status : 'todo';
      t.priority = PRIORITY[t.priority] ? t.priority : 'normal';
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* stockage indisponible ou corrompu */ }
    return emptyState();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Impossible d'enregistrer les données sur cet appareil.");
    }
  }

  let state = load();
  const ui = { objFilter: 'active', taskFilter: { q: '', status: 'open', assignee: '', objective: '' } };

  // ------------------------------------------------------------------
  // Accès aux données & calculs
  // ------------------------------------------------------------------
  const byId = (list, id) => list.find((x) => x.id === id);
  const person = (id) => byId(state.people, id);
  const team = (id) => byId(state.teams, id);
  const objective = (id) => byId(state.objectives, id);
  const task = (id) => byId(state.tasks, id);
  const tasksOf = (objectiveId) => state.tasks.filter((t) => t.objectiveId === objectiveId);
  const isActiveTask = (t) => { const o = objective(t.objectiveId); return o && !o.archived; };

  function tasksForPerson(pid) {
    const teamIds = state.teams.filter((t) => t.memberIds.includes(pid)).map((t) => t.id);
    return state.tasks.filter((t) => t.assignee && (
      (t.assignee.type === 'person' && t.assignee.id === pid) ||
      (t.assignee.type === 'team' && teamIds.includes(t.assignee.id))));
  }

  function tasksForTeam(tid) {
    const tm = team(tid);
    if (!tm) return [];
    return state.tasks.filter((t) => t.assignee && (
      (t.assignee.type === 'team' && t.assignee.id === tid) ||
      (t.assignee.type === 'person' && tm.memberIds.includes(t.assignee.id))));
  }

  const taskPct = (t) => (t.status === 'done' ? 100 : clamp(t.progress));
  const isLate = (t) => t.status !== 'done' && !!t.dueDate && t.dueDate < today();

  function weightedPct(tasks) {
    let w = 0, s = 0;
    for (const t of tasks) { w += t.weight || 1; s += (t.weight || 1) * taskPct(t); }
    return w ? Math.round(s / w) : 0;
  }

  /** Avancement attendu (en %) d'après le temps écoulé entre début et échéance. */
  function expectedPct(o) {
    if (!o.startDate || !o.dueDate || o.dueDate <= o.startDate) return null;
    return clamp(Math.round((daysBetween(o.startDate, today()) / daysBetween(o.startDate, o.dueDate)) * 100));
  }

  function health(o) {
    const ts = tasksOf(o.id);
    if (!ts.length) return 'empty';
    const p = weightedPct(ts);
    if (p >= 100) return 'done';
    if (o.dueDate && o.dueDate < today()) return 'late';
    if (ts.some((t) => t.status === 'blocked' || isLate(t))) return 'risk';
    const exp = expectedPct(o);
    if (exp !== null && exp - p > 20) return 'risk';
    return 'ok';
  }

  /** Reconstitue l'évolution quotidienne de l'avancement d'un objectif à partir de l'historique des tâches. */
  function objectiveSeries(o) {
    const ts = tasksOf(o.id);
    const events = [];
    for (const t of ts) {
      const w = t.weight || 1;
      for (const h of t.history) events.push({ at: h.at, id: t.id, p: h.status === 'done' ? 100 : clamp(h.progress), w });
    }
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // Toutes les tâches actuelles comptent dès le départ (à 0 %) : on mesure l'avancement sur le périmètre complet.
    const current = new Map(ts.map((t) => [t.id, { p: 0, w: t.weight || 1 }]));
    const byDay = new Map();
    const first = [o.startDate, ...ts.map((t) => isoDay(new Date(t.createdAt)))].filter(Boolean).sort()[0];
    if (first && ts.length) byDay.set(first, 0);
    for (const e of events) {
      current.set(e.id, e);
      let w = 0, s = 0;
      for (const v of current.values()) { w += v.w; s += v.w * v.p; }
      byDay.set(isoDay(new Date(e.at)), Math.round(s / w));
    }
    const pts = [...byDay].map(([d, p]) => ({ d, p }));
    if (ts.length) {
      const d = today(), p = weightedPct(ts);
      if (pts.length && pts[pts.length - 1].d === d) pts[pts.length - 1].p = p;
      else pts.push({ d, p });
    }
    return pts;
  }

  /** Enregistre une mise à jour d'avancement dans l'historique de la tâche. */
  function recordProgress(t, progress, status, note) {
    progress = clamp(progress);
    if (status === 'done') progress = 100;
    else if (progress === 100 && status !== 'blocked') status = 'done';
    else if (progress > 0 && status === 'todo') status = 'doing';
    t.progress = progress;
    t.status = status;
    t.updatedAt = new Date().toISOString();
    t.history.push({ at: t.updatedAt, progress, status, note: (note || '').trim() });
  }

  // ------------------------------------------------------------------
  // Fragments d'interface
  // ------------------------------------------------------------------
  const bar = (p, cls = '') => `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span style="width:${p}%"></span></div>`;
  const healthBadge = (h) => `<span class="badge h-${h}">${HEALTH[h]}</span>`;
  const statusBadge = (s) => `<span class="badge st-${s}">${STATUS[s]}</span>`;

  function avatar(entity, kind = 'person', size = '') {
    if (!entity) return `<span class="avatar ${size}" style="background:#9ca3af">?</span>`;
    return `<span class="avatar ${kind === 'team' ? 'team' : ''} ${size}" style="background:${esc(entity.color || COLORS[0])}">${esc(initials(entity.name))}</span>`;
  }

  function assigneeEntity(a) {
    if (!a) return null;
    return a.type === 'team' ? team(a.id) : person(a.id);
  }

  function assigneeChip(a) {
    const e = assigneeEntity(a);
    if (!a || !e) return '<span class="chip muted">Non assigné</span>';
    const href = a.type === 'team' ? `#/groupe/${e.id}` : `#/personne/${e.id}`;
    return `<span class="chip" data-href="${href}">${avatar(e, a.type)}${esc(e.name)}</span>`;
  }

  function objectiveCard(o) {
    const ts = tasksOf(o.id);
    const p = weightedPct(ts);
    const h = health(o);
    const done = ts.filter((t) => t.status === 'done').length;
    return `<a class="card" href="#/objectif/${o.id}">
      <div class="row"><h3>${esc(o.title)}</h3>${o.archived ? '<span class="badge archived">Archivé</span>' : healthBadge(h)}</div>
      <div class="meta">${assigneeChip(o.assignee)}<span>· Échéance ${fmtDate(o.dueDate)}</span></div>
      ${bar(p, 'h-' + h)}
      <div class="meta row"><span><b>${p}%</b> réalisé</span><span>${done}/${ts.length} tâches</span></div>
    </a>`;
  }

  function taskRow(t, { showObjective = true } = {}) {
    const o = objective(t.objectiveId);
    const p = taskPct(t);
    return `<div class="task ${t.status === 'done' ? 'is-done' : ''}">
      <button class="check" type="button" data-action="toggle-done" data-id="${t.id}"
        aria-label="${t.status === 'done' ? 'Rouvrir la tâche' : 'Marquer comme terminée'}">${t.status === 'done' ? '✓' : ''}</button>
      <a class="task-body" href="#/tache/${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        <div class="meta">
          ${statusBadge(t.status)}
          ${t.priority === 'high' ? '<span class="badge prio">Priorité haute</span>' : ''}
          ${assigneeChip(t.assignee)}
          ${t.dueDate ? `<span class="${isLate(t) ? 'late' : ''}">· ${isLate(t) ? 'En retard, ' : ''}${fmtDate(t.dueDate)}</span>` : ''}
        </div>
        ${showObjective && o ? `<div class="meta">🎯 ${esc(o.title)}</div>` : ''}
        ${bar(p, 'thin ' + (t.status === 'blocked' || isLate(t) ? 'h-late' : t.status === 'done' ? 'h-done' : ''))}
      </a>
      <span class="pct">${p}%</span>
    </div>`;
  }

  const sortTasks = (ts) => [...ts].sort((a, b) =>
    (a.status === 'done') - (b.status === 'done') ||
    (a.dueDate || '9999') .localeCompare(b.dueDate || '9999') ||
    (b.priority === 'high') - (a.priority === 'high'));

  const taskList = (ts, opts) => (ts.length
    ? `<div class="stack">${sortTasks(ts).map((t) => taskRow(t, opts)).join('')}</div>`
    : '<div class="empty-inline">Aucune tâche.</div>');

  function chartSVG(o, pts) {
    if (!pts.length) return '';
    const W = 340, H = 170, L = 32, R = 12, T = 10, B = 26;
    const dates = pts.map((p) => p.d);
    if (o.startDate) dates.push(o.startDate);
    if (o.dueDate) dates.push(o.dueDate);
    dates.push(today());
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const span = Math.max(1, daysBetween(min, max));
    const x = (d) => (L + ((W - L - R) * daysBetween(min, d)) / span).toFixed(1);
    const y = (p) => (T + (H - T - B) * (1 - p / 100)).toFixed(1);

    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de l'avancement">`;
    for (const g of [0, 25, 50, 75, 100]) {
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 6}" y="${+y(g) + 3}" text-anchor="end">${g}%</text>`;
    }
    const tx = x(today());
    svg += `<line class="today" x1="${tx}" x2="${tx}" y1="${T}" y2="${H - B}"/>`;
    if (o.startDate && o.dueDate && o.dueDate > o.startDate) {
      svg += `<line class="ideal" x1="${x(o.startDate)}" y1="${y(0)}" x2="${x(o.dueDate)}" y2="${y(100)}"/>`;
    }
    // Courbe en escalier : l'avancement reste constant jusqu'à la mise à jour suivante.
    let d = `M${x(pts[0].d)},${y(pts[0].p)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].d)} V${y(pts[i].p)}`;
    svg += `<path class="real" d="${d}"/>`;
    for (const p of pts) svg += `<circle class="dot" cx="${x(p.d)}" cy="${y(p.p)}" r="3.5"><title>${fmtDate(p.d)} : ${p.p}%</title></circle>`;
    svg += `<text x="${L}" y="${H - 8}">${fmtDate(min).slice(0, 5)}</text>`;
    svg += `<text x="${W - R}" y="${H - 8}" text-anchor="end">${fmtDate(max).slice(0, 5)}</text>`;
    svg += `<text x="${tx}" y="${H - 8}" text-anchor="middle">auj.</text>`;
    return svg + '</svg>';
  }

  function statRows(entries) {
    if (!entries.length) return '<div class="empty-inline">Aucune tâche assignée pour le moment.</div>';
    return `<div class="stack">${entries.map(({ entity, kind, tasks }) => {
      const p = weightedPct(tasks);
      const done = tasks.filter((t) => t.status === 'done').length;
      const late = tasks.filter(isLate).length;
      const href = kind === 'team' ? `#/groupe/${entity.id}` : `#/personne/${entity.id}`;
      return `<a class="list-row" href="${href}">
        ${avatar(entity, kind, 'lg')}
        <div class="grow">
          <div class="row"><span class="name">${esc(entity.name)}</span><b>${p}%</b></div>
          ${bar(p, 'thin ' + (late ? 'h-risk' : 'h-ok'))}
          <div class="meta">${done}/${tasks.length} terminées${late ? ` · <span class="late">${late} en retard</span>` : ''}</div>
        </div>
      </a>`;
    }).join('')}</div>`;
  }

  // ------------------------------------------------------------------
  // Vues
  // ------------------------------------------------------------------
  function viewWelcome() {
    return `<div class="empty">
      <h2>Bienvenue 👋</h2>
      <p>Créez vos objectifs, découpez-les en tâches, assignez-les à des personnes ou à des équipes, puis suivez l'avancement au jour le jour.</p>
      <div class="actions">
        <button class="btn primary" data-action="new-objective">Créer un objectif</button>
        <button class="btn" data-action="sample">Voir un exemple</button>
      </div>
    </div>`;
  }

  function viewDashboard() {
    if (!state.objectives.length && !state.people.length) return { title: 'Tableau de bord', html: viewWelcome(), fab: 'new-objective' };

    const active = state.objectives.filter((o) => !o.archived);
    const tasks = state.tasks.filter(isActiveTask);
    const done = tasks.filter((t) => t.status === 'done').length;
    const late = tasks.filter(isLate);
    const blocked = tasks.filter((t) => t.status === 'blocked');
    const avg = active.length ? Math.round(active.reduce((s, o) => s + weightedPct(tasksOf(o.id)), 0) / active.length) : 0;
    const alerts = sortTasks([...new Set([...blocked, ...late])]);

    const perf = [
      ...state.teams.map((e) => ({ entity: e, kind: 'team', tasks: tasksForTeam(e.id).filter(isActiveTask) })),
      ...state.people.map((e) => ({ entity: e, kind: 'person', tasks: tasksForPerson(e.id).filter(isActiveTask) })),
    ].filter((x) => x.tasks.length);

    const activity = state.tasks
      .flatMap((t) => t.history.map((h) => ({ t, h })))
      .sort((a, b) => (a.h.at < b.h.at ? 1 : -1))
      .slice(0, 6);

    const html = `
      <section class="kpis">
        <div class="kpi"><b>${active.length}</b><span>Objectifs actifs</span></div>
        <div class="kpi"><b>${avg}%</b><span>Avancement moyen</span></div>
        <div class="kpi"><b>${done}/${tasks.length}</b><span>Tâches terminées</span></div>
        <div class="kpi ${late.length ? 'alert' : ''}"><b>${late.length}</b><span>Tâches en retard</span></div>
      </section>

      <section>
        <h2 class="section-title">Objectifs en cours <a class="muted" href="#/objectifs">Tout voir</a></h2>
        ${active.length ? `<div class="stack">${active.map(objectiveCard).join('')}</div>` : '<div class="empty-inline">Aucun objectif actif.</div>'}
      </section>

      ${alerts.length ? `<section>
        <h2 class="section-title">À surveiller (${alerts.length})</h2>
        ${taskList(alerts.slice(0, 5))}
      </section>` : ''}

      <section>
        <h2 class="section-title">Avancement par équipe et par personne</h2>
        ${statRows(perf)}
      </section>

      ${activity.length ? `<section>
        <h2 class="section-title">Activité récente</h2>
        <div class="card"><ul class="timeline">${activity.map(({ t, h }) => `
          <li><div class="when">${fmtDateTime(h.at)}</div>
          <div class="what"><a href="#/tache/${t.id}">${esc(t.title)}</a> → ${h.progress}% · ${STATUS[h.status]}</div>
          ${h.note ? `<div class="note muted">${esc(h.note)}</div>` : ''}</li>`).join('')}
        </ul></div>
      </section>` : ''}`;
    return { title: 'Tableau de bord', html, fab: 'new-objective' };
  }

  function viewObjectives() {
    const f = ui.objFilter;
    const list = state.objectives.filter((o) =>
      f === 'archived' ? o.archived : !o.archived && (f === 'done' ? health(o) === 'done' : health(o) !== 'done'));
    const seg = (key, label) => `<button type="button" data-action="obj-filter" data-value="${key}" aria-pressed="${f === key}">${label}</button>`;
    const html = `
      <div class="segmented">${seg('active', 'En cours')}${seg('done', 'Atteints')}${seg('archived', 'Archivés')}</div>
      ${list.length ? `<div class="stack">${list.map(objectiveCard).join('')}</div>`
        : state.objectives.length ? '<div class="empty-inline">Aucun objectif dans cette catégorie.</div>' : viewWelcome()}`;
    return { title: 'Objectifs', html, fab: 'new-objective' };
  }

  function viewObjective(id) {
    const o = objective(id);
    if (!o) return notFound();
    const ts = tasksOf(o.id);
    const p = weightedPct(ts);
    const h = health(o);
    const exp = expectedPct(o);
    const pts = objectiveSeries(o);
    const html = `
      <section class="card">
        <div class="row"><h3>${esc(o.title)}</h3>${o.archived ? '<span class="badge archived">Archivé</span>' : healthBadge(h)}</div>
        ${o.description ? `<p class="desc">${esc(o.description)}</p>` : ''}
        <div class="meta">Responsable : ${assigneeChip(o.assignee)}</div>
        <div class="meta">Du ${fmtDate(o.startDate)} au ${fmtDate(o.dueDate)}${o.dueDate && h !== 'done' ? ` · ${daysLeftLabel(o.dueDate)}` : ''}</div>
        ${o.target ? `<div class="meta">Résultat attendu : <b>${esc(o.target)}</b></div>` : ''}
        <div class="big-pct"><b>${p}%</b><span class="muted">réalisé${exp !== null && h !== 'done' ? ` · ${exp}% attendu à ce jour` : ''}</span></div>
        ${bar(p, 'h-' + h)}
        <div class="actions">
          <button class="btn sm" data-action="edit-objective" data-id="${o.id}">Modifier</button>
          <button class="btn sm" data-action="archive-objective" data-id="${o.id}">${o.archived ? 'Désarchiver' : 'Archiver'}</button>
          <button class="btn sm danger" data-action="delete-objective" data-id="${o.id}">Supprimer</button>
        </div>
      </section>

      ${pts.length ? `<section class="card">
        <h2 class="section-title">Évolution de l'avancement</h2>
        ${chartSVG(o, pts)}
        <div class="legend"><span><i></i>Réalisé</span>${o.startDate && o.dueDate ? '<span><i class="ideal"></i>Rythme prévu</span>' : ''}</div>
      </section>` : ''}

      <section>
        <h2 class="section-title">Tâches (${ts.length})
          <button class="btn sm" data-action="new-task" data-objective="${o.id}">+ Tâche</button></h2>
        ${taskList(ts, { showObjective: false })}
      </section>`;
    return { title: 'Objectif', html, back: true, fab: 'new-task', fabData: { objective: o.id } };
  }

  function daysLeftLabel(due) {
    const n = daysBetween(today(), due);
    if (n < 0) return `<span class="late">échéance dépassée de ${plural(-n, 'jour', 'jours')}</span>`;
    if (n === 0) return "<span class=\"late\">échéance aujourd'hui</span>";
    return `${plural(n, 'jour restant', 'jours restants')}`;
  }

  function viewTasks() {
    const f = ui.taskFilter;
    const html = `
      <div class="filters">
        <input class="full" type="search" id="f-q" placeholder="Rechercher une tâche…" value="${esc(f.q)}" aria-label="Rechercher">
        <select id="f-status" aria-label="Statut">
          <option value="open">Non terminées</option>
          <option value="">Tous les statuts</option>
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          <option value="late">En retard</option>
        </select>
        <select id="f-assignee" aria-label="Assignée à">
          <option value="">Tout le monde</option>
          ${assigneeOptions()}
        </select>
        <select class="full" id="f-objective" aria-label="Objectif">
          <option value="">Tous les objectifs actifs</option>
          ${state.objectives.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${esc(o.title)}</option>`).join('')}
        </select>
      </div>
      <div id="task-results"></div>`;
    return {
      title: 'Tâches', html, fab: 'new-task',
      after() {
        $('#f-status').value = f.status;
        $('#f-assignee').value = f.assignee;
        $('#f-objective').value = f.objective;
        const update = () => {
          f.q = $('#f-q').value; f.status = $('#f-status').value;
          f.assignee = $('#f-assignee').value; f.objective = $('#f-objective').value;
          renderTaskResults();
        };
        for (const id of ['#f-q', '#f-status', '#f-assignee', '#f-objective']) $(id).addEventListener('input', update);
        renderTaskResults();
      },
    };
  }

  function renderTaskResults() {
    const f = ui.taskFilter;
    let ts = state.tasks.filter(isActiveTask);
    if (f.objective) ts = ts.filter((t) => t.objectiveId === f.objective);
    if (f.assignee) {
      const [type, id] = f.assignee.split(':');
      ts = ts.filter((t) => (type === 'team' ? tasksForTeam(id) : tasksForPerson(id)).includes(t));
    }
    if (f.status === 'open') ts = ts.filter((t) => t.status !== 'done');
    else if (f.status === 'late') ts = ts.filter(isLate);
    else if (f.status) ts = ts.filter((t) => t.status === f.status);
    const q = f.q.trim().toLowerCase();
    if (q) ts = ts.filter((t) => `${t.title} ${t.description || ''}`.toLowerCase().includes(q));
    const el = $('#task-results');
    if (!el) return;
    el.innerHTML = state.objectives.length
      ? `<p class="meta">${plural(ts.length, 'tâche', 'tâches')}</p>${taskList(ts)}`
      : '<div class="empty-inline">Créez d\'abord un objectif pour pouvoir y ajouter des tâches.</div>';
  }

  function viewTask(id) {
    const t = task(id);
    if (!t) return notFound();
    const o = objective(t.objectiveId);
    const p = taskPct(t);
    const html = `
      <section class="card">
        <div class="row"><h3>${esc(t.title)}</h3>${statusBadge(t.status)}</div>
        ${o ? `<div class="meta">🎯 <a href="#/objectif/${o.id}"><u>${esc(o.title)}</u></a></div>` : ''}
        ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
        <div class="meta">Assignée à : ${assigneeChip(t.assignee)}</div>
        <div class="meta">Échéance : <span class="${isLate(t) ? 'late' : ''}">${fmtDate(t.dueDate)}${isLate(t) ? ' (en retard)' : ''}</span>
          · Priorité : ${PRIORITY[t.priority]} · Poids : ${t.weight}</div>
        <div class="big-pct"><b>${p}%</b><span class="muted">d'avancement</span></div>
        ${bar(p, t.status === 'blocked' || isLate(t) ? 'h-late' : 'h-ok')}
        <button class="btn primary block" style="margin-top:14px" data-action="update-progress" data-id="${t.id}">Mettre à jour l'avancement</button>
        <div class="actions">
          <button class="btn sm" data-action="edit-task" data-id="${t.id}">Modifier</button>
          <button class="btn sm danger" data-action="delete-task" data-id="${t.id}">Supprimer</button>
        </div>
      </section>
      <section>
        <h2 class="section-title">Historique de l'avancement</h2>
        ${t.history.length ? `<div class="card"><ul class="timeline">${[...t.history].reverse().map((h) => `
          <li><div class="when">${fmtDateTime(h.at)}</div>
          <div class="what">${h.progress}% · ${STATUS[h.status]}</div>
          ${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}</li>`).join('')}
          <li><div class="when">${fmtDateTime(t.createdAt)}</div><div class="what">Tâche créée</div></li>
        </ul></div>` : '<div class="empty-inline">Aucune mise à jour pour le moment. Utilisez « Mettre à jour l\'avancement » pour garder une trace de la progression.</div>'}
      </section>`;
    return { title: 'Tâche', html, back: true, fab: 'update-progress', fabData: { id: t.id } };
  }

  function viewTeam() {
    const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const html = `
      <section>
        <h2 class="section-title">Équipes (${teams.length}) <button class="btn sm" data-action="new-team">+ Équipe</button></h2>
        ${teams.length ? statRows(teams.map((e) => ({ entity: e, kind: 'team', tasks: tasksForTeam(e.id).filter(isActiveTask) })))
          : '<div class="empty-inline">Aucune équipe. Regroupez des personnes pour suivre un objectif collectif.</div>'}
      </section>
      <section>
        <h2 class="section-title">Personnes (${people.length}) <button class="btn sm" data-action="new-person">+ Personne</button></h2>
        ${people.length ? `<div class="stack">${people.map((e) => {
          const ts = tasksForPerson(e.id).filter(isActiveTask);
          const p = weightedPct(ts);
          return `<a class="list-row" href="#/personne/${e.id}">${avatar(e, 'person', 'lg')}
            <div class="grow"><div class="row"><span class="name">${esc(e.name)}</span><b>${ts.length ? p + '%' : ''}</b></div>
            <div class="meta">${e.role ? esc(e.role) + ' · ' : ''}${plural(ts.length, 'tâche', 'tâches')}</div></div></a>`;
        }).join('')}</div>` : '<div class="empty-inline">Ajoutez les membres que vous souhaitez suivre.</div>'}
      </section>`;
    return { title: 'Équipe', html, fab: 'new-person' };
  }

  function entityStats(ts) {
    const active = ts.filter(isActiveTask);
    const done = active.filter((t) => t.status === 'done').length;
    const late = active.filter(isLate).length;
    return `<section class="kpis">
      <div class="kpi"><b>${weightedPct(active)}%</b><span>Avancement</span></div>
      <div class="kpi"><b>${active.length}</b><span>Tâches</span></div>
      <div class="kpi"><b>${done}</b><span>Terminées</span></div>
      <div class="kpi ${late ? 'alert' : ''}"><b>${late}</b><span>En retard</span></div>
    </section>`;
  }

  function viewPerson(id) {
    const e = person(id);
    if (!e) return notFound();
    const teams = state.teams.filter((t) => t.memberIds.includes(e.id));
    const objs = state.objectives.filter((o) => !o.archived && o.assignee?.type === 'person' && o.assignee.id === e.id);
    const html = `
      <section class="list-row">${avatar(e, 'person', 'lg')}
        <div class="grow"><div class="name">${esc(e.name)}</div>
        <div class="meta">${e.role ? esc(e.role) : 'Aucun rôle précisé'}${teams.length ? ' · ' + teams.map((t) => `<a href="#/groupe/${t.id}"><u>${esc(t.name)}</u></a>`).join(', ') : ''}</div></div>
      </section>
      <div class="actions" style="margin-top:10px">
        <button class="btn sm" data-action="edit-person" data-id="${e.id}">Modifier</button>
        <button class="btn sm danger" data-action="delete-person" data-id="${e.id}">Supprimer</button>
      </div>
      <section>${entityStats(tasksForPerson(e.id))}</section>
      ${objs.length ? `<section><h2 class="section-title">Objectifs dont il/elle est responsable</h2><div class="stack">${objs.map(objectiveCard).join('')}</div></section>` : ''}
      <section><h2 class="section-title">Tâches (directes et via ses équipes)</h2>${taskList(tasksForPerson(e.id).filter(isActiveTask))}</section>`;
    return { title: e.name, html, back: true, fab: 'new-task', fabData: { assignee: `person:${e.id}` } };
  }

  function viewTeamDetail(id) {
    const e = team(id);
    if (!e) return notFound();
    const members = e.memberIds.map(person).filter(Boolean);
    const objs = state.objectives.filter((o) => !o.archived && o.assignee?.type === 'team' && o.assignee.id === e.id);
    const html = `
      <section class="list-row">${avatar(e, 'team', 'lg')}
        <div class="grow"><div class="name">${esc(e.name)}</div><div class="meta">${plural(members.length, 'membre', 'membres')}</div></div>
      </section>
      <div class="actions" style="margin-top:10px">
        <button class="btn sm" data-action="edit-team" data-id="${e.id}">Modifier</button>
        <button class="btn sm danger" data-action="delete-team" data-id="${e.id}">Supprimer</button>
      </div>
      <section>${entityStats(tasksForTeam(e.id))}</section>
      <section><h2 class="section-title">Avancement des membres</h2>
        ${members.length ? statRows(members.map((m) => ({ entity: m, kind: 'person', tasks: tasksForPerson(m.id).filter((t) => isActiveTask(t) && tasksForTeam(e.id).includes(t)) })))
          : '<div class="empty-inline">Aucun membre. Modifiez l\'équipe pour en ajouter.</div>'}
      </section>
      ${objs.length ? `<section><h2 class="section-title">Objectifs de l'équipe</h2><div class="stack">${objs.map(objectiveCard).join('')}</div></section>` : ''}
      <section><h2 class="section-title">Tâches de l'équipe et de ses membres</h2>${taskList(tasksForTeam(e.id).filter(isActiveTask))}</section>`;
    return { title: e.name, html, back: true, fab: 'new-task', fabData: { assignee: `team:${e.id}` } };
  }

  let deferredInstall = null;

  function viewSettings() {
    const counts = `${plural(state.objectives.length, 'objectif', 'objectifs')}, ${plural(state.tasks.length, 'tâche', 'tâches')}, ${plural(state.people.length, 'personne', 'personnes')}, ${plural(state.teams.length, 'équipe', 'équipes')}`;
    const html = `
      ${deferredInstall ? `<section class="card"><h3>Installer l'application</h3>
        <p class="muted">Ajoutez l'application à l'écran d'accueil de votre téléphone pour l'ouvrir comme une application classique, même sans connexion.</p>
        <div class="actions"><button class="btn primary" data-action="install">Installer</button></div></section>` : ''}
      <section class="card">
        <h3>Sauvegarde et partage</h3>
        <p class="muted">Les données (${counts}) sont enregistrées uniquement sur cet appareil. Exportez-les régulièrement pour les sauvegarder ou les transférer sur un autre téléphone.</p>
        <div class="actions">
          <button class="btn" data-action="export">Exporter (.json)</button>
          <button class="btn" data-action="import">Importer…</button>
        </div>
      </section>
      <section class="card">
        <h3>Données</h3>
        <div class="actions">
          <button class="btn" data-action="sample">Charger un exemple</button>
          <button class="btn danger" data-action="reset">Tout effacer</button>
        </div>
      </section>
      <section class="card">
        <h3>Comment ça marche ?</h3>
        <p class="muted">L'avancement d'un objectif est la moyenne pondérée (par le poids) de l'avancement de ses tâches. Un objectif est « à risque » s'il contient une tâche bloquée ou en retard, ou si son avancement a plus de 20 points de retard sur le rythme prévu entre sa date de début et son échéance.</p>
      </section>`;
    return { title: 'Réglages', html, back: true };
  }

  const notFound = () => ({ title: 'Introuvable', html: '<div class="empty"><h2>Élément introuvable</h2><p>Il a peut-être été supprimé.</p><a class="btn" href="#/">Retour au tableau de bord</a></div>', back: true });

  // ------------------------------------------------------------------
  // Routeur & rendu
  // ------------------------------------------------------------------
  const routes = {
    '': [viewDashboard, 'tableau'],
    objectifs: [viewObjectives, 'objectifs'],
    objectif: [viewObjective, 'objectifs'],
    taches: [viewTasks, 'taches'],
    tache: [viewTask, 'taches'],
    equipe: [viewTeam, 'equipe'],
    personne: [viewPerson, 'equipe'],
    groupe: [viewTeamDetail, 'equipe'],
    reglages: [viewSettings, ''],
  };

  let lastRoute = '';

  function render() {
    const [name = '', id] = location.hash.replace(/^#\/?/, '').split('/');
    const [view, tab] = routes[name] || routes[''];
    const v = view(id ? decodeURIComponent(id) : undefined);
    $('#title').textContent = v.title;
    document.title = `${v.title} · Suivi d'Objectifs`;
    $('#back').hidden = !v.back;
    $('#view').innerHTML = v.html;
    const fab = $('#fab');
    fab.hidden = !v.fab;
    fab.dataset.action = v.fab || '';
    for (const k of Object.keys(fab.dataset)) if (k !== 'action') delete fab.dataset[k];
    Object.assign(fab.dataset, v.fabData || {});
    fab.setAttribute('aria-label', v.fab === 'update-progress' ? "Mettre à jour l'avancement" : 'Ajouter');
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (v.after) v.after();
    if (location.hash !== lastRoute) { window.scrollTo(0, 0); lastRoute = location.hash; }
  }

  function commit(message) {
    save();
    render();
    if (message) toast(message);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------
  // Formulaires
  // ------------------------------------------------------------------
  const field = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;

  function assigneeOptions(selected = '') {
    const opt = (v, label) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`;
    return `${state.teams.length ? `<optgroup label="Équipes">${state.teams.map((t) => opt(`team:${t.id}`, t.name)).join('')}</optgroup>` : ''}
      ${state.people.length ? `<optgroup label="Personnes">${state.people.map((p) => opt(`person:${p.id}`, p.name)).join('')}</optgroup>` : ''}`;
  }
  const assigneeValue = (a) => (a ? `${a.type}:${a.id}` : '');
  const parseAssignee = (v) => { if (!v) return null; const [type, id] = v.split(':'); return { type, id }; };

  function assigneeSelect(selected) {
    const hint = !state.people.length && !state.teams.length ? '<span class="meta">Ajoutez des personnes ou des équipes dans l\'onglet « Équipe ».</span>' : '';
    return field('Assigné à', `<select name="assignee"><option value="">— Non assigné —</option>${assigneeOptions(selected)}</select>${hint}`);
  }

  function openForm({ title, body, submit = 'Enregistrer', onSubmit, onOpen }) {
    const dlg = $('#modal');
    dlg.innerHTML = `<form class="sheet" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">✕</button></header>
      <div class="sheet-body">${body}</div>
      <footer><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary" type="submit">${esc(submit)}</button></footer>
    </form>`;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const required = [...form.querySelectorAll('[required]')].find((el) => !el.value.trim());
      if (required) { required.focus(); toast('Merci de remplir les champs obligatoires.'); return; }
      const data = Object.fromEntries(new FormData(form));
      const message = onSubmit(data, form);
      if (message === false) return;
      dlg.close();
      commit(message);
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.showModal();
    if (onOpen) onOpen(form);
  }

  function objectiveForm(o) {
    const isNew = !o;
    o = o || { startDate: today() };
    openForm({
      title: isNew ? 'Nouvel objectif' : "Modifier l'objectif",
      submit: isNew ? 'Créer' : 'Enregistrer',
      body: `
        ${field('Intitulé *', `<input name="title" required maxlength="140" value="${esc(o.title)}" placeholder="Ex. : Augmenter les ventes de 15 %">`)}
        ${field('Description', `<textarea name="description" maxlength="2000">${esc(o.description)}</textarea>`)}
        ${field('Résultat attendu / indicateur', `<input name="target" maxlength="140" value="${esc(o.target)}" placeholder="Ex. : 120 nouveaux clients">`)}
        ${assigneeSelect(assigneeValue(o.assignee))}
        <div class="field-row">
          ${field('Début', `<input type="date" name="startDate" value="${esc(o.startDate)}">`)}
          ${field('Échéance', `<input type="date" name="dueDate" value="${esc(o.dueDate)}">`)}
        </div>`,
      onSubmit(d) {
        if (d.startDate && d.dueDate && d.dueDate < d.startDate) { toast("L'échéance doit être après la date de début."); return false; }
        const fields = { title: d.title.trim(), description: d.description.trim(), target: d.target.trim(), assignee: parseAssignee(d.assignee), startDate: d.startDate, dueDate: d.dueDate };
        if (isNew) {
          const n = { id: uid(), createdAt: new Date().toISOString(), archived: false, ...fields };
          state.objectives.push(n);
          location.hash = `#/objectif/${n.id}`;
          return 'Objectif créé. Ajoutez-lui des tâches !';
        }
        Object.assign(o, fields);
        return 'Objectif mis à jour.';
      },
    });
  }

  function taskForm(t, defaults = {}) {
    const isNew = !t;
    const objs = state.objectives.filter((o) => !o.archived || o.id === t?.objectiveId);
    if (!objs.length) { toast("Créez d'abord un objectif."); objectiveForm(); return; }
    t = t || { priority: 'normal', weight: 1, objectiveId: defaults.objective || objs[0].id, assignee: parseAssignee(defaults.assignee) };
    if (isNew && !t.assignee) {
      const o = objective(t.objectiveId);
      t.assignee = o?.assignee || null;
    }
    openForm({
      title: isNew ? 'Nouvelle tâche' : 'Modifier la tâche',
      submit: isNew ? 'Créer' : 'Enregistrer',
      body: `
        ${field('Intitulé *', `<input name="title" required maxlength="140" value="${esc(t.title)}" placeholder="Ex. : Relancer les 20 prospects">`)}
        ${field('Objectif *', `<select name="objectiveId" required>${objs.map((o) => `<option value="${o.id}" ${o.id === t.objectiveId ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}</select>`)}
        ${assigneeSelect(assigneeValue(t.assignee))}
        <div class="field-row">
          ${field('Échéance', `<input type="date" name="dueDate" value="${esc(t.dueDate)}">`)}
          ${field('Priorité', `<select name="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === t.priority ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        </div>
        ${field('Poids dans l\'objectif (1 à 10)', `<input type="number" name="weight" min="1" max="10" step="1" value="${esc(t.weight)}">`)}
        ${field('Description', `<textarea name="description" maxlength="2000">${esc(t.description)}</textarea>`)}`,
      onSubmit(d) {
        const fields = {
          title: d.title.trim(), objectiveId: d.objectiveId, assignee: parseAssignee(d.assignee), dueDate: d.dueDate,
          priority: d.priority, weight: clamp(Math.round(d.weight) || 1, 1, 10), description: d.description.trim(),
        };
        if (isNew) {
          const now = new Date().toISOString();
          state.tasks.push({ id: uid(), createdAt: now, updatedAt: now, status: 'todo', progress: 0, history: [], ...fields });
          return 'Tâche ajoutée.';
        }
        Object.assign(t, fields, { updatedAt: new Date().toISOString() });
        return 'Tâche mise à jour.';
      },
    });
  }

  function progressForm(t) {
    openForm({
      title: "Mettre à jour l'avancement",
      body: `
        <p class="muted" style="margin-top:0">${esc(t.title)}</p>
        <div class="range-value"><output id="pv">${taskPct(t)}</output>%</div>
        ${field('Avancement', `<input type="range" name="progress" min="0" max="100" step="5" value="${taskPct(t)}">`)}
        ${field('Statut', `<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        ${field('Commentaire (ce qui a été fait, difficultés…)', '<textarea name="note" maxlength="1000"></textarea>')}`,
      onOpen(form) {
        const range = form.elements.progress, status = form.elements.status;
        range.addEventListener('input', () => {
          $('#pv').textContent = range.value;
          if (range.value === '100' && status.value !== 'blocked') status.value = 'done';
          else if (status.value === 'done') status.value = 'doing';
          else if (+range.value > 0 && status.value === 'todo') status.value = 'doing';
        });
        status.addEventListener('change', () => {
          if (status.value === 'done') { range.value = 100; $('#pv').textContent = '100'; }
        });
      },
      onSubmit(d) {
        recordProgress(t, d.progress, d.status, d.note);
        return 'Avancement enregistré.';
      },
    });
  }

  function personForm(p) {
    const isNew = !p;
    p = p || {};
    openForm({
      title: isNew ? 'Nouvelle personne' : 'Modifier la personne',
      body: `
        ${field('Nom *', `<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="Prénom Nom">`)}
        ${field('Rôle / fonction', `<input name="role" maxlength="80" value="${esc(p.role)}" placeholder="Ex. : Commercial">`)}
        ${state.teams.length ? field('Équipes', `<div class="checks">${state.teams.map((t) => `<label><input type="checkbox" name="teams" value="${t.id}" ${p.id && t.memberIds.includes(p.id) ? 'checked' : ''}>${esc(t.name)}</label>`).join('')}</div>`) : ''}`,
      onSubmit(d, form) {
        const teamIds = [...form.querySelectorAll('input[name="teams"]:checked')].map((el) => el.value);
        if (isNew) {
          p = { id: uid(), color: COLORS[state.people.length % COLORS.length] };
          state.people.push(p);
        }
        p.name = d.name.trim();
        p.role = (d.role || '').trim();
        for (const t of state.teams) {
          const has = t.memberIds.includes(p.id);
          if (teamIds.includes(t.id) && !has) t.memberIds.push(p.id);
          if (!teamIds.includes(t.id) && has) t.memberIds = t.memberIds.filter((id) => id !== p.id);
        }
        return isNew ? 'Personne ajoutée.' : 'Personne mise à jour.';
      },
    });
  }

  function teamForm(t) {
    const isNew = !t;
    t = t || { memberIds: [] };
    openForm({
      title: isNew ? 'Nouvelle équipe' : "Modifier l'équipe",
      body: `
        ${field('Nom de l\'équipe *', `<input name="name" required maxlength="80" value="${esc(t.name)}" placeholder="Ex. : Équipe commerciale">`)}
        ${field('Membres', state.people.length
          ? `<div class="checks">${state.people.map((p) => `<label><input type="checkbox" name="members" value="${p.id}" ${t.memberIds.includes(p.id) ? 'checked' : ''}>${avatar(p)} ${esc(p.name)}</label>`).join('')}</div>`
          : '<div class="meta">Ajoutez d\'abord des personnes pour pouvoir les associer à l\'équipe.</div>')}`,
      onSubmit(d, form) {
        if (isNew) {
          t = { id: uid(), color: COLORS[(state.teams.length + 4) % COLORS.length], memberIds: [] };
          state.teams.push(t);
        }
        t.name = d.name.trim();
        t.memberIds = [...form.querySelectorAll('input[name="members"]:checked')].map((el) => el.value);
        return isNew ? 'Équipe créée.' : 'Équipe mise à jour.';
      },
    });
  }

  // ------------------------------------------------------------------
  // Données d'exemple
  // ------------------------------------------------------------------
  function sampleData() {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
    const at = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const s = emptyState();
    const P = (name, role, i) => { const p = { id: uid(), name, role, color: COLORS[i] }; s.people.push(p); return p; };
    const awa = P('Awa Koné', 'Cheffe de projet', 0);
    const yao = P('Yao Kouassi', 'Commercial', 1);
    const fatou = P('Fatou Traoré', 'Comptable', 4);
    const jean = P("Jean N'Guessan", 'Technicien', 2);
    const aya = P('Aya Diabaté', 'Commerciale', 6);
    const com = { id: uid(), name: 'Équipe commerciale', color: COLORS[5], memberIds: [awa.id, yao.id, aya.id] };
    const fin = { id: uid(), name: 'Finance', color: COLORS[7], memberIds: [fatou.id] };
    s.teams.push(com, fin);

    const O = (title, assignee, start, due, extra = {}) => {
      const o = { id: uid(), title, assignee, startDate: day(start), dueDate: day(due), createdAt: at(start, 8), archived: false, description: '', target: '', ...extra };
      s.objectives.push(o);
      return o;
    };
    const T = (o, title, assignee, due, steps, extra = {}) => {
      const created = steps.length ? steps[0][0] - 1 : -10;
      const t = { id: uid(), objectiveId: o.id, title, assignee, dueDate: due === null ? '' : day(due), priority: 'normal', weight: 1, description: '', createdAt: at(created, 9), status: 'todo', progress: 0, history: [], ...extra };
      for (const [d, p, st, note] of steps) {
        t.history.push({ at: at(d, 11), progress: st === 'done' ? 100 : p, status: st, note: note || '' });
        t.progress = st === 'done' ? 100 : p; t.status = st;
      }
      t.updatedAt = t.history.length ? t.history[t.history.length - 1].at : t.createdAt;
      s.tasks.push(t);
    };
    const ref = (e, type = 'person') => ({ type, id: e.id });

    const o1 = O('Augmenter le chiffre d\'affaires de 15 %', ref(com, 'team'), -30, 60,
      { description: 'Développer le portefeuille clients de la région d\'Abidjan sur le trimestre.', target: '+15 % de CA vs trimestre précédent' });
    T(o1, 'Établir la liste des 100 prospects prioritaires', ref(yao), -20, [[-26, 40, 'doing'], [-22, 100, 'done', 'Liste validée avec Awa.']], { weight: 2 });
    T(o1, 'Préparer la nouvelle plaquette commerciale', ref(aya), -5, [[-18, 30, 'doing'], [-10, 60, 'doing', 'Maquette envoyée à l\'imprimeur.'], [-3, 80, 'doing']]);
    T(o1, 'Rencontrer 40 prospects', ref(com, 'team'), 30, [[-15, 10, 'doing', '4 rendez-vous réalisés.'], [-8, 25, 'doing'], [-1, 40, 'doing', '16 rendez-vous réalisés.']], { weight: 4, priority: 'high' });
    T(o1, 'Signer 10 nouveaux contrats', ref(awa), 55, [[-6, 20, 'doing', '2 contrats signés.']], { weight: 3, priority: 'high' });

    const o2 = O('Clôturer les comptes de l\'exercice', ref(fatou), -20, 10, { target: 'États financiers validés' });
    T(o2, 'Rapprochements bancaires', ref(fatou), -10, [[-18, 50, 'doing'], [-12, 100, 'done']]);
    T(o2, 'Inventaire des stocks', ref(fin, 'team'), -2, [[-14, 30, 'doing'], [-6, 50, 'blocked', 'En attente des fiches du dépôt de Bouaké.']], { priority: 'high' });
    T(o2, 'Préparer la liasse fiscale', ref(fatou), 8, [], { weight: 2 });

    const o3 = O('Déployer le nouveau logiciel de caisse', ref(jean), -45, 5);
    T(o3, 'Installer les postes en boutique', ref(jean), -15, [[-40, 30, 'doing'], [-30, 70, 'doing'], [-20, 100, 'done']], { weight: 2 });
    T(o3, 'Former les caissiers', ref(awa), 0, [[-12, 25, 'doing', 'Session 1 sur 4 terminée.'], [-4, 50, 'doing']]);
    T(o3, 'Migrer l\'historique des ventes', ref(jean), 3, [[-9, 20, 'doing']]);
    return s;
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `suivi-objectifs-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Fichier exporté.');
  }

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.objectives) || !Array.isArray(data.tasks)) throw new Error('format');
      if (!confirm('Remplacer les données actuelles par celles du fichier ?')) return;
      state = normalize(data);
      location.hash = '#/';
      commit('Données importées.');
    } catch (err) {
      toast("Ce fichier n'est pas une sauvegarde valide.");
    }
  });

  const actions = {
    'new-objective': () => objectiveForm(),
    'edit-objective': ({ id }) => objectiveForm(objective(id)),
    'archive-objective': ({ id }) => {
      const o = objective(id);
      o.archived = !o.archived;
      commit(o.archived ? 'Objectif archivé.' : 'Objectif réactivé.');
    },
    'delete-objective': ({ id }) => {
      const o = objective(id);
      const n = tasksOf(id).length;
      if (!confirm(`Supprimer l'objectif « ${o.title} »${n ? ` et ses ${plural(n, 'tâche', 'tâches')}` : ''} ?`)) return;
      state.objectives = state.objectives.filter((x) => x.id !== id);
      state.tasks = state.tasks.filter((t) => t.objectiveId !== id);
      location.hash = '#/objectifs';
      commit('Objectif supprimé.');
    },
    'new-task': (d) => taskForm(null, d),
    'edit-task': ({ id }) => taskForm(task(id)),
    'delete-task': ({ id }) => {
      const t = task(id);
      if (!confirm(`Supprimer la tâche « ${t.title} » ?`)) return;
      state.tasks = state.tasks.filter((x) => x.id !== id);
      location.hash = `#/objectif/${t.objectiveId}`;
      commit('Tâche supprimée.');
    },
    'update-progress': ({ id }) => progressForm(task(id)),
    'toggle-done': ({ id }) => {
      const t = task(id);
      if (t.status === 'done') {
        const prev = [...t.history].reverse().find((h) => h.status !== 'done');
        recordProgress(t, Math.min(prev ? prev.progress : 0, 95), 'doing', 'Tâche rouverte');
      }
      else recordProgress(t, 100, 'done', '');
      commit(t.status === 'done' ? 'Tâche terminée 🎉' : 'Tâche rouverte.');
    },
    'new-person': () => personForm(),
    'edit-person': ({ id }) => personForm(person(id)),
    'delete-person': ({ id }) => {
      const p = person(id);
      if (!confirm(`Supprimer ${p.name} ? Ses tâches et objectifs deviendront « non assignés ».`)) return;
      state.people = state.people.filter((x) => x.id !== id);
      for (const t of state.teams) t.memberIds = t.memberIds.filter((m) => m !== id);
      for (const x of [...state.tasks, ...state.objectives]) if (x.assignee?.type === 'person' && x.assignee.id === id) x.assignee = null;
      location.hash = '#/equipe';
      commit('Personne supprimée.');
    },
    'new-team': () => teamForm(),
    'edit-team': ({ id }) => teamForm(team(id)),
    'delete-team': ({ id }) => {
      const t = team(id);
      if (!confirm(`Supprimer l'équipe « ${t.name} » ? Les membres sont conservés.`)) return;
      state.teams = state.teams.filter((x) => x.id !== id);
      for (const x of [...state.tasks, ...state.objectives]) if (x.assignee?.type === 'team' && x.assignee.id === id) x.assignee = null;
      location.hash = '#/equipe';
      commit('Équipe supprimée.');
    },
    'obj-filter': ({ value }) => { ui.objFilter = value; render(); },
    export: exportData,
    import: () => $('#import-file').click(),
    sample: () => {
      if (state.objectives.length && !confirm("Remplacer les données actuelles par l'exemple ?")) return;
      state = sampleData();
      location.hash = '#/';
      commit("Données d'exemple chargées.");
    },
    reset: () => {
      if (!confirm('Effacer définitivement toutes les données de cet appareil ?')) return;
      state = emptyState();
      location.hash = '#/';
      commit('Toutes les données ont été effacées.');
    },
    install: async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      render();
    },
  };

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-href]');
    if (chip) { e.preventDefault(); location.hash = chip.dataset.href; return; }
    const el = e.target.closest('[data-action]');
    if (!el || !el.dataset.action) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn({ ...el.dataset }); }
  });

  $('#back').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); render(); } });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (location.hash === '#/reglages') render(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  render();
})();
