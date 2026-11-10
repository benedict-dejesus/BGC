// BGC runs entirely in the student's browser. Key derivation here must stay
// in step with tools/lib/crypto.mjs, which encrypts the records.
const DIGITS = 10;
const IV_BYTES = 12;
const IDLE_LIMIT_MS = 10 * 60 * 1000;
const TEAR_MS = 420;
const SHAKE_MS = 340;

const SCORE_ICONS = [
  [/sketch/i, 'pencil'], [/coffee/i, 'cup'], [/theater/i, 'mask'], [/guitar/i, 'guitar'],
  [/photo/i, 'camera'], [/exam/i, 'exam'], [/attendance/i, 'calendar'], [/quiz/i, 'quiz'],
];
const READING_ICONS = {
  overall: 'award', missing: 'alert', strength: 'star', focus: 'target', trend: 'trend', pending: 'calendar',
  completion: 'check', receiving: 'alert',
};
const WIDE_READINGS = new Set(['completion', 'receiving']);
const READING_TITLES = { complete: 'What your record shows', pending: 'Your record' };
const SCORE_PARTS = ['result', 'stats', 'scores'];

const THEME_COLORS = { light: '#FFF7F7', dark: '#002C39' };

const MESSAGES = {
  incomplete: `Enter all ${DIGITS} digits of your student number.`,
  notFound: 'No record matches that student number. Check the digits and try again.',
  network: "BGC can't reach the server. Check your connection and try again.",
  unreadable: "This record can't be opened. Please message Benedict on Facebook.",
  notPosted: "Records aren't posted yet. Check back after the announcement in class.",
  unsupported: "This browser can't open records. Update it or use a different browser.",
  timedOut: 'Your record closed after 10 minutes without activity.',
  lowMemory: "This device couldn't open the record. Close other apps or tabs and try again, or use a different device.",
};

const $ = (id) => document.getElementById(id);
const entry = $('entry');
const record = $('record');
const form = $('lookup');
const input = $('student-number');
const submit = $('submit');
const message = $('form-message');
const digitCount = $('digit-count');
const pips = [...$('pips').children];

let manifest = null;
let idleTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function badge(name) {
  const node = el('span', 'badge');
  node.append(icon(name));
  return node;
}

/* Theme */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[theme];
  $('theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('theme-label').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  try {
    localStorage.setItem('bgc-theme', next);
  } catch {
    // The choice just won't be remembered next time.
  }
}

/* Records */

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Argon2id from the vendored hash-wasm file, with the settings the records were locked with. */
async function deriveRecordKeys(number) {
  const bits = await globalThis.hashwasm.argon2id({
    password: number,
    salt: fromBase64(manifest.salt),
    parallelism: 1,
    iterations: manifest.kdf.passes,
    memorySize: manifest.kdf.memoryKiB,
    hashLength: 48,
    outputType: 'binary',
  });
  const id = [...bits.slice(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt']);
  return { id, key };
}

async function openRecord(number) {
  let derived;
  try {
    derived = await deriveRecordKeys(number);
  } catch {
    throw new Error(MESSAGES.lowMemory);
  }
  const { id, key } = derived;
  let response;
  try {
    response = await fetch(`data/records/${id}.bin`, { cache: 'no-cache' });
  } catch {
    throw new Error(MESSAGES.network);
  }
  if (response.status === 404) throw new Error(MESSAGES.notFound);
  if (!response.ok) throw new Error(MESSAGES.network);

  const file = new Uint8Array(await response.arrayBuffer());
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: file.slice(0, IV_BYTES), additionalData: new TextEncoder().encode(id) },
      key,
      file.slice(IV_BYTES),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error(MESSAGES.unreadable);
  }
}

/* Rendering */

function scoreRow(item) {
  const row = el('li', 'score');
  const iconName = SCORE_ICONS.find(([pattern]) => pattern.test(item.label))?.[1] ?? 'quiz';
  row.append(badge(iconName), el('span', 'score-label', item.label));

  const bar = el('span', 'score-bar');
  bar.setAttribute('aria-hidden', 'true');
  if (item.score === null) {
    row.classList.add('is-missing');
    row.append(el('span', 'score-value', 'No score recorded'));
  } else {
    row.append(el('span', 'score-value', `${item.score} / ${item.max}`));
    const fill = el('span', 'score-fill');
    fill.dataset.width = `${Math.min(100, (item.score / item.max) * 100)}%`;
    bar.append(fill);
  }
  row.append(bar);
  return row;
}

function termBlock(term) {
  const block = el('section', 'tile term');
  const head = el('div', 'term-head');
  const grade = el('p', 'term-grade');
  grade.append(el('span', '', term.grade.label), el('strong', '', term.grade.value));
  head.append(el('h3', '', term.title), grade);

  const list = el('ul', 'score-list');
  list.append(...term.items.map(scoreRow));
  block.append(head, list);
  return block;
}

function statTile(iconName, label, value, isText = false) {
  const tile = el('div', 'stat');
  tile.append(
    el('span', 'stat-label', label),
    icon(iconName),
    el('span', `stat-value${isText ? ' is-text' : ''}`, value),
  );
  return tile;
}

function changeText(midterm, finals) {
  const change = Math.round((Number(finals) - Number(midterm)) * 100) / 100;
  return change > 0 ? `+${change}` : String(change).replace('-', '\u2212');
}

function renderStats(terms) {
  const items = terms.flatMap((term) => term.items);
  const recorded = items.filter((item) => item.score !== null).length;
  const [midterm, finals] = terms.map((term) => term.grade);
  const complete = recorded === items.length;
  const change = statTile('trend', 'Midterm to Finals', complete ? changeText(midterm.value, finals.value) : 'Waiting for scores', !complete);
  change.classList.toggle('is-falling', complete && Number(finals.value) < Number(midterm.value));
  $('stats').replaceChildren(
    statTile('exam', midterm.label, midterm.value),
    statTile('exam', finals.label, finals.value),
    change,
    statTile('check', 'Scores recorded', `${recorded} of ${items.length}`),
  );
}

function renderResult(summary) {
  const [average, equivalent, remarks] = summary;
  $('gauge-value').textContent = average.value;
  $('gauge-label').textContent = average.label;
  const percent = Math.max(0, Math.min(100, Number(average.value) || 0));
  $('gauge-arc').dataset.percent = String(percent);

  const standing = el('div', 'standing');
  standing.append(el('span', 'standing-label', equivalent.label), el('strong', 'standing-value', equivalent.value));

  const status = el('div', 'remarks');
  const value = el('span', 'remarks-value');
  value.append(icon(remarks.value === 'Passed' ? 'check' : 'alert'), remarks.value);
  status.append(el('span', '', remarks.label), value);
  $('result-main').replaceChildren(standing, status);
}

/** A record still being graded shows only the note, with no scores or grade. */
function renderRecord(data) {
  const pending = data.status === 'pending';
  $('greeting').textContent = `Hi, ${data.greetingName}!`;
  $('identity').textContent = data.fullName;
  $('section-chip').textContent = data.section;

  SCORE_PARTS.forEach((id) => { $(id).hidden = pending; });
  $('reading-title').textContent = READING_TITLES[pending ? 'pending' : 'complete'];
  if (!pending) {
    renderResult(data.summary);
    renderStats(data.terms);
    $('terms').replaceChildren(...data.terms.map(termBlock));
  }

  $('interpretation').replaceChildren(...data.interpretation.map((item) => {
    const lead = item.kind === 'overall' || item.kind === 'pending';
    const width = WIDE_READINGS.has(item.kind) ? ` is-wide is-${item.kind}` : '';
    const block = el('div', `reading-item${lead ? ' is-lead' : ''}${width}`);
    block.append(badge(READING_ICONS[item.kind] ?? 'award'), el('h3', '', item.heading));
    if (item.text) block.append(el('p', '', item.text));
    if (item.steps?.length) {
      const list = el('ol', 'reading-steps');
      list.append(...item.steps.map((step) => el('li', '', step)));
      block.append(list);
    }
    return block;
  }));

  const updated = new Date(manifest.updatedAt).toLocaleDateString('en-PH', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  $('updated').textContent = pending
    ? `Records last updated ${updated}. This record closes after 10 minutes without activity.`
    : `Scores last updated ${updated}. These are the grades you will receive in the university portal. This record closes after 10 minutes without activity.`;
}

/** Bars and the gauge start empty, then fill once the record is on screen. */
function fillMeters() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const arc = $('gauge-arc');
    arc.setAttribute('stroke-dasharray', `${arc.dataset.percent} 100`);
    document.querySelectorAll('.score-fill').forEach((fill) => { fill.style.width = fill.dataset.width; });
  }));
}

/* Screens */

function showMessage(text) {
  message.textContent = text;
  input.setAttribute('aria-invalid', text ? 'true' : 'false');
}

function updateDigitCount() {
  digitCount.textContent = `${input.value.length} of ${DIGITS} digits`;
  pips.forEach((pip, index) => pip.classList.toggle('is-on', index < input.value.length));
}

function shakeInput() {
  form.classList.add('is-shaking');
  setTimeout(() => form.classList.remove('is-shaking'), SHAKE_MS);
}

function setBusy(busy) {
  submit.disabled = busy;
  submit.classList.toggle('is-busy', busy);
  $('submit-label').textContent = busy ? 'Opening your record...' : 'View my record';
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => closeRecord(MESSAGES.timedOut), IDLE_LIMIT_MS);
}

function stopIdleWatch() {
  clearTimeout(idleTimer);
  for (const name of ['pointerdown', 'keydown', 'scroll']) window.removeEventListener(name, resetIdleTimer);
}

function startIdleWatch() {
  for (const name of ['pointerdown', 'keydown', 'scroll']) {
    window.addEventListener(name, resetIdleTimer, { passive: true });
  }
  resetIdleTimer();
}

function showRecord() {
  entry.hidden = true;
  record.hidden = false;
  $('topbar-close').hidden = false;
  form.classList.remove('is-torn');
  window.scrollTo(0, 0);
  $('greeting').focus({ preventScroll: true });
  startIdleWatch();
  fillMeters();
}

function closeRecord(notice = '') {
  stopIdleWatch();
  for (const id of ['greeting', 'identity', 'section-chip', 'gauge-value', 'gauge-label', 'updated']) $(id).textContent = '';
  for (const id of ['result-main', 'stats', 'terms', 'interpretation']) $(id).replaceChildren();
  $('gauge-arc').setAttribute('stroke-dasharray', '0 100');
  SCORE_PARTS.forEach((id) => { $(id).hidden = false; });
  $('reading-title').textContent = READING_TITLES.complete;
  record.hidden = true;
  $('topbar-close').hidden = true;
  entry.hidden = false;
  input.value = '';
  updateDigitCount();
  message.textContent = notice;
  input.removeAttribute('aria-invalid');
  window.scrollTo(0, 0);
  input.focus({ preventScroll: true });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!manifest) return;
  if (input.value.length !== DIGITS) {
    showMessage(MESSAGES.incomplete);
    shakeInput();
    input.focus();
    return;
  }

  showMessage('');
  setBusy(true);
  try {
    const data = await openRecord(input.value);
    renderRecord(data);
    input.value = '';
    updateDigitCount();
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm) {
      form.classList.add('is-torn');
      await new Promise((resolve) => { setTimeout(resolve, TEAR_MS); });
    }
    showRecord();
  } catch (error) {
    showMessage(error.message);
    shakeInput();
    input.focus();
  } finally {
    setBusy(false);
  }
}

async function start() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  $('theme-toggle').addEventListener('click', toggleTheme);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeRecord()));
  form.addEventListener('submit', handleSubmit);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, DIGITS);
    updateDigitCount();
    if (message.textContent) showMessage('');
  });

  if (!window.crypto?.subtle || typeof WebAssembly !== 'object' || !globalThis.hashwasm?.argon2id) {
    submit.disabled = true;
    input.disabled = true;
    message.textContent = MESSAGES.unsupported;
    return;
  }

  try {
    const response = await fetch('data/manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('not posted');
    manifest = await response.json();
    if (manifest.kdf?.name !== 'argon2id') throw new Error('old manifest');
    $('course-chip').textContent = `${manifest.course}, ${manifest.term}`;
    $('course-chip').hidden = false;
  } catch {
    submit.disabled = true;
    input.disabled = true;
    message.textContent = MESSAGES.notPosted;
  }
}

start();
