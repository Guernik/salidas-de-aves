// Renders data/outings.json (written by the ig-monitor publish workflow). No build step.
const TZ = 'America/Argentina/Buenos_Aires';
const DAY_MS = 86400000;

const $ = (sel) => document.querySelector(sel);
const state = { view: 'upcoming', outings: [] };

// YYYY-MM-DD in Buenos Aires, regardless of the visitor's timezone
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo

const fmtDay = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (iso) => fmtDay.format(new Date(`${iso}T12:00:00Z`));
const month = (iso) => fmtMonth.format(new Date(`${iso}T12:00:00Z`));

// Saturday and Sunday of this weekend (on a Sunday, today only)
function weekend() {
  const wd = weekday(today);
  if (wd === 0) return [today, today];
  const sat = addDays(today, 6 - wd);
  return [sat, addDays(sat, 1)];
}

const nextDate = (o) => o.dates.find((d) => d >= today) ?? null;
const lastDate = (o) => o.dates.at(-1) ?? o.expires_on;
const isUpcoming = (o) => o.expires_on >= today;

function matches(o) {
  const q = $('#q').value.trim().toLocaleLowerCase('es');
  const club = $('#club').value;
  if (club && o.username !== club) return false;
  if (q) {
    const text = [o.title, o.location, o.details, o.username, o.full_name].filter(Boolean).join(' ').toLocaleLowerCase('es');
    if (!text.includes(q)) return false;
  }
  const when = state.view === 'upcoming' ? $('#when').value : '';
  if (when) {
    const next = nextDate(o);
    if (!next) return false;
    if (when === 'weekend') {
      const [sat, sun] = weekend();
      return o.dates.some((d) => d >= sat && d <= sun);
    }
    return next <= addDays(today, Number(when));
  }
  return true;
}

function upcomingGroup(o) {
  const next = nextDate(o);
  if (!next) return 'Fecha a confirmar';
  const [sat, sun] = weekend();
  if (next >= sat && next <= sun) return 'Este fin de semana';
  if (next <= addDays(today, 7)) return 'Próximos días';
  return 'Más adelante';
}

function groups(list) {
  if (state.view === 'upcoming') {
    const order = ['Este fin de semana', 'Próximos días', 'Más adelante', 'Fecha a confirmar'];
    const sorted = [...list].sort((a, b) =>
      `${nextDate(a) ?? '9999'} ${a.start_time ?? ''}`.localeCompare(`${nextDate(b) ?? '9999'} ${b.start_time ?? ''}`));
    return order.map((name) => [name, sorted.filter((o) => upcomingGroup(o) === name)]).filter(([, l]) => l.length);
  }
  const sorted = [...list].sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
  const byMonth = new Map();
  for (const o of sorted) {
    const name = month(lastDate(o));
    byMonth.set(name, [...(byMonth.get(name) ?? []), o]);
  }
  return [...byMonth];
}

function whenText(o) {
  if (!o.dates.length) return 'Fecha a confirmar';
  if (state.view === 'upcoming') {
    const [next, ...later] = o.dates.filter((d) => d >= today);
    return `${day(next)}${o.start_time ? ` · ${o.start_time}` : ''}${later.length ? ` (también ${later.map(day).join(', ')})` : ''}`;
  }
  return `${o.dates.map(day).join(', ')}${o.start_time ? ` · ${o.start_time}` : ''}`;
}

function card(o) {
  const node = $('#card').content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector('.thumb');
  if (o.image) {
    thumb.href = o.post_url;
    thumb.querySelector('img').src = `data/${o.image}`;
  } else {
    thumb.remove();
  }
  node.querySelector('.when').textContent = whenText(o);
  node.querySelector('.title').textContent = o.title || 'Salida de observación de aves';
  const fill = (sel, text) => (text ? (node.querySelector(sel).textContent = text) : node.querySelector(sel).remove());
  fill('.where', o.location);
  fill('.details', o.details);
  const account = node.querySelector('.account');
  account.href = `https://www.instagram.com/${encodeURIComponent(o.username)}/`;
  account.textContent = `@${o.username}`;
  if (o.full_name) account.title = o.full_name;
  node.querySelector('.post').href = o.post_url;
  if (o.caption) node.querySelector('.caption p').textContent = o.caption;
  else node.querySelector('.caption').remove();
  return node;
}

function render() {
  const pool = state.outings.filter((o) => (state.view === 'upcoming') === isUpcoming(o));
  const shown = pool.filter(matches);
  const list = $('#list');
  list.replaceChildren();
  for (const [name, items] of groups(shown)) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = name;
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.append(...items.map(card));
    section.append(h2, grid);
    list.append(section);
  }
  const noun = state.view === 'upcoming' ? ['salida próxima', 'salidas próximas'] : ['salida anterior', 'salidas anteriores'];
  $('#count').textContent = shown.length === pool.length
    ? `${pool.length} ${noun[pool.length === 1 ? 0 : 1]}`
    : `${shown.length} de ${pool.length} ${noun[1]}`;
  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = pool.length ? 'Ninguna salida coincide con los filtros.' : 'Todavía no hay salidas para mostrar.';
    list.append(p);
  }
  $('#when-field').hidden = state.view !== 'upcoming';
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  render();
}

async function main() {
  // webcal:// makes phones and calendar apps offer to subscribe instead of downloading
  $('#subscribe').href = new URL('data/salidas.ics', location.href).href.replace(/^https?:/, 'webcal:');

  try {
    const res = await fetch('data/outings.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.outings = (await res.json()).outings;
    const modified = res.headers.get('last-modified');
    if (modified) {
      $('#updated').textContent = `Actualizado: ${new Date(modified).toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' })}`;
    }
  } catch (e) {
    $('#list').innerHTML = '<p class="empty">No se pudieron cargar las salidas. Probá de nuevo en un rato.</p>';
    return;
  }

  const clubs = [...new Set(state.outings.map((o) => o.username))].sort();
  $('#club').append(...clubs.map((u) => new Option(`@${u}`, u)));

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  for (const id of ['#q', '#club', '#when']) $(id).addEventListener('input', render);
  render();
}

main();
