// Renders data/outings.json (written by the ig-monitor publish workflow). No build step.
const TZ = 'America/Argentina/Buenos_Aires';
const UTC_OFFSET_H = 3; // Argentina has no DST
const DAY_MS = 86400000;

const $ = (sel, root = document) => root.querySelector(sel);

// YYYY-MM-DD in Buenos Aires, regardless of the visitor's timezone
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const noon = (iso) => new Date(`${iso}T12:00:00Z`);
const addDays = (iso, n) => new Date(noon(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (iso) => noon(iso).getUTCDay(); // 0 = domingo

const fmt = (opts) => new Intl.DateTimeFormat('es-AR', { ...opts, timeZone: 'UTC' });
const fmtShort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const fmtWeekday = fmt({ weekday: 'long' });
const fmtMonth = fmt({ month: 'long' });
const cap = (s) => s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
const shortDay = (iso) => fmtShort.format(noon(iso));
function longDay(iso) {
  const d = noon(iso);
  const year = iso.slice(0, 4) === today.slice(0, 4) ? '' : ` de ${iso.slice(0, 4)}`;
  return cap(`${fmtWeekday.format(d)} ${d.getUTCDate()} de ${fmtMonth.format(d)}${year}`);
}

const state = {
  view: 'upcoming',
  outings: [],
  day: null, // YYYY-MM-DD picked on the calendar
  month: today.slice(0, 7), // YYYY-MM shown on the calendar
};

// Saturday and Sunday of this weekend (on a Sunday, today only)
function weekend() {
  const wd = weekday(today);
  if (wd === 0) return [today, today];
  const sat = addDays(today, 6 - wd);
  return [sat, addDays(sat, 1)];
}

const isUpcoming = (o) => o.expires_on >= today;
const inView = (o) => (state.view === 'upcoming') === isUpcoming(o);
// The dates that matter in the current view
const viewDates = (o) => (state.view === 'upcoming' ? o.dates.filter((d) => d >= today) : o.dates);

function matchesFilters(o) {
  const q = $('#q').value.trim().toLocaleLowerCase('es');
  const club = $('#club').value;
  if (club && o.username !== club) return false;
  if (q) {
    const text = [o.title, o.location, o.details, o.username, o.full_name].filter(Boolean).join(' ').toLocaleLowerCase('es');
    if (!text.includes(q)) return false;
  }
  const when = state.view === 'upcoming' ? $('#when').value : '';
  if (when) {
    const dates = viewDates(o);
    if (when === 'weekend') {
      const [sat, sun] = weekend();
      return dates.some((d) => d >= sat && d <= sun);
    }
    return dates.some((d) => d <= addDays(today, Number(when)));
  }
  return true;
}

// The date an outing is listed under, or null when it has none
function listedDate(o) {
  if (state.day) return state.day;
  const dates = viewDates(o);
  return (state.view === 'upcoming' ? dates[0] : dates.at(-1)) ?? null;
}

function groups(list) {
  const byDay = new Map();
  for (const o of list) {
    const d = listedDate(o);
    byDay.set(d, [...(byDay.get(d) ?? []), o]);
  }
  const days = [...byDay.keys()].filter(Boolean).sort();
  if (state.view === 'past') days.reverse();
  if (byDay.has(null)) days.push(null);
  const byTime = (a, b) => (a.start_time ?? '99').localeCompare(b.start_time ?? '99');
  return days.map((d) => [d, byDay.get(d).sort(byTime)]);
}

function relative(iso) {
  if (state.view !== 'upcoming' || !iso) return '';
  if (iso === today) return 'hoy';
  if (iso === addDays(today, 1)) return 'mañana';
  const [sat, sun] = weekend();
  return iso >= sat && iso <= sun ? 'este finde' : '';
}

// Stable small tilt per flyer, so the page looks pasted in by hand
function tilt(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `${((Math.abs(h) % 9) - 4) / 2}deg`;
}

const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// iCalendar for one outing, same shape as data/salidas.ics (3 h events, UTC times)
function ics(o, dates) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => line.match(/.{1,60}/gu).join('\r\n ');
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d+/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//salidas-de-aves//web//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const d of dates) {
    const [y, m, day] = d.split('-').map(Number);
    lines.push('BEGIN:VEVENT', `UID:${o.key.replace(/[^\w.-]+/g, '-')}-${d}@salidas-de-aves`, `DTSTAMP:${stamp(Date.now())}`);
    if (o.start_time) {
      const [hh, mm] = o.start_time.split(':').map(Number);
      const start = Date.UTC(y, m - 1, day, hh + UTC_OFFSET_H, mm);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(start + 3 * 3600000)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(d, 1).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${esc(`${o.title || 'Salida de observación de aves'} (@${o.username})`)}`);
    if (o.location) lines.push(`LOCATION:${esc(o.location)}`);
    lines.push(`DESCRIPTION:${esc([o.details, `Publicación: ${o.post_url}`].filter(Boolean).join('\n'))}`, `URL:${o.post_url}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}

function row(o, listed) {
  const node = $('#row').content.firstElementChild.cloneNode(true);
  const fill = (sel, text) => (text ? ($(sel, node).textContent = text) : $(sel, node).remove());

  const time = $('.time', node);
  if (o.start_time) time.textContent = o.start_time;
  else {
    time.textContent = 'sin hora';
    time.classList.add('unknown');
  }

  $('.title', node).textContent = o.title || 'Salida de observación de aves';
  fill('.where', o.location);
  fill('.note', o.details);
  const others = o.dates.filter((d) => d !== listed && (state.view === 'past' || d >= today));
  fill('.also', others.length ? `También ${others.map(shortDay).join(', ')}` : '');

  const account = $('.account', node);
  account.href = `https://www.instagram.com/${encodeURIComponent(o.username)}/`;
  account.textContent = `@${o.username}`;
  if (o.full_name) account.title = o.full_name;
  if (o.location) $('.maps', node).href = mapsUrl(o.location);
  else $('.maps', node).remove();
  const dates = viewDates(o);
  if (dates.length) {
    const link = $('.ics', node);
    link.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics(o, dates))}`;
    link.download = `salida-${o.username}-${dates[0]}.ics`;
    link.title = 'Agregar esta salida a tu calendario';
  } else {
    $('.ics', node).remove();
  }
  $('.post', node).href = o.post_url;
  if (o.caption) $('.caption p', node).textContent = o.caption;
  else $('.caption', node).remove();

  const flyer = $('.flyer', node);
  if (o.image) {
    $('img', flyer).src = `data/${o.image}`;
    flyer.setAttribute('aria-label', `Ver el flyer de @${o.username} en grande`);
    flyer.style.setProperty('--tilt', tilt(o.key));
    flyer.addEventListener('click', () => openViewer(o));
  } else {
    flyer.remove();
  }
  return node;
}

function openViewer(o) {
  const dialog = $('#viewer');
  $('img', dialog).src = `data/${o.image}`;
  $('img', dialog).alt = `Flyer de @${o.username}`;
  $('.post', dialog).href = o.post_url;
  dialog.showModal();
}

function renderList(shown, poolSize) {
  const list = $('#list');
  list.replaceChildren();
  for (const [d, items] of groups(shown)) {
    const page = $('#day').content.firstElementChild.cloneNode(true);
    $('h2', page).textContent = d ? longDay(d) : state.view === 'upcoming' ? 'Fecha a confirmar' : 'Sin fecha';
    const rel = relative(d);
    if (rel) $('.rel', page).textContent = rel;
    else $('.rel', page).remove();
    $('.n', page).textContent = `${items.length} ${items.length === 1 ? 'salida' : 'salidas'}`;
    $('.rows', page).append(...items.map((o) => row(o, d)));
    list.append(page);
  }
  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'empty hand';
    p.textContent = poolSize ? 'ninguna salida coincide con los filtros' : 'todavía no hay salidas para mostrar';
    list.append(p);
  }
}

function renderCount(shown, poolSize) {
  const count = $('#count');
  const noun = state.view === 'upcoming' ? ['salida próxima', 'salidas próximas'] : ['salida anterior', 'salidas anteriores'];
  count.textContent = shown.length === poolSize
    ? `${poolSize} ${noun[poolSize === 1 ? 0 : 1]}`
    : `${shown.length} de ${poolSize} ${noun[1]}`;
  if (state.day) {
    count.append(` · solo el ${shortDay(state.day)} `);
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'link';
    all.textContent = 'Ver todas';
    all.addEventListener('click', () => {
      state.day = null;
      render();
    });
    count.append(all);
  }
}

function renderCalendar(filtered) {
  const perDay = new Map();
  for (const o of filtered) for (const d of viewDates(o)) perDay.set(d, (perDay.get(d) ?? 0) + 1);

  const first = `${state.month}-01`;
  const d0 = noon(first);
  $('#cal-title').textContent = cap(`${fmtMonth.format(d0)}${state.month.slice(0, 4) === today.slice(0, 4) ? '' : ` ${state.month.slice(0, 4)}`}`);
  const grid = $('#cal-days');
  grid.replaceChildren();
  const lead = (weekday(first) + 6) % 7; // weeks start on Monday
  for (let i = 0; i < lead; i++) grid.append(document.createElement('span'));
  for (let d = first; d.startsWith(state.month); d = addDays(d, 1)) {
    const n = perDay.get(d);
    const label = String(Number(d.slice(8)));
    let cell;
    if (n) {
      cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'outing';
      cell.setAttribute('aria-pressed', String(state.day === d));
      cell.setAttribute('aria-label', `${longDay(d)}: ${n} ${n === 1 ? 'salida' : 'salidas'}`);
      cell.addEventListener('click', () => {
        state.day = state.day === d ? null : d;
        render();
        if (state.day && matchMedia('(max-width: 899px)').matches) $('#list').scrollIntoView({ behavior: 'smooth' });
      });
    } else {
      cell = document.createElement('span');
      if (d < today) cell.className = 'past';
    }
    if (d === today) cell.classList.add('today');
    cell.textContent = label;
    grid.append(cell);
  }
}

function render() {
  const pool = state.outings.filter(inView);
  const filtered = pool.filter(matchesFilters);
  const shown = state.day ? filtered.filter((o) => o.dates.includes(state.day)) : filtered;
  renderList(shown, pool.length);
  renderCount(shown, pool.length);
  renderCalendar(filtered);
  $('#when-field').hidden = state.view !== 'upcoming';
}

function setView(view) {
  state.view = view;
  state.day = null;
  // Past view opens on the month of the latest past outing
  const latest = view === 'past' ? state.outings.filter(inView).flatMap((o) => o.dates).sort().at(-1) : null;
  state.month = (latest ?? today).slice(0, 7);
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  render();
}

function shiftMonth(n) {
  const [y, m] = state.month.split('-').map(Number);
  state.month = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  render();
}

async function main() {
  // webcal:// makes phones and calendar apps offer to subscribe instead of downloading
  const webcal = new URL('data/salidas.ics', location.href).href.replace(/^https?:/, 'webcal:');
  document.querySelectorAll('.subscribe').forEach((a) => (a.href = webcal));

  const dialog = $('#viewer');
  $('.close', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

  try {
    const res = await fetch('data/outings.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.outings = (await res.json()).outings;
    const modified = res.headers.get('last-modified');
    if (modified) {
      $('#updated').textContent = `Actualizado: ${new Date(modified).toLocaleString('es-AR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' })}`;
    }
  } catch {
    $('#list').innerHTML = '<p class="empty hand">no se pudieron cargar las salidas: probá de nuevo en un rato</p>';
    return;
  }

  const clubs = [...new Set(state.outings.map((o) => o.username))].sort();
  $('#club').append(...clubs.map((u) => new Option(`@${u}`, u)));

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  for (const id of ['#q', '#club', '#when']) $(id).addEventListener('input', render);
  $('#prev-month').addEventListener('click', () => shiftMonth(-1));
  $('#next-month').addEventListener('click', () => shiftMonth(1));
  render();
}

main();
