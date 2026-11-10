import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInThisContext } from 'node:vm';
import { deflateRawSync } from 'node:zlib';
import { demoSheets, DEMO_STUDENTS } from '../tools/lib/demo.mjs';
import { buildRecords, greetingName, formatNumber } from '../tools/lib/records.mjs';
import { interpret } from '../tools/lib/interpret.mjs';
import { deriveRecordKeys, encryptRecord, decryptRecord } from '../tools/lib/crypto.mjs';
import { unzip, decodeXml, redStyles } from '../tools/lib/xlsx.mjs';

const messages = JSON.parse(readFileSync(new URL('../config/messages.json', import.meta.url)));
const css = readFileSync(new URL('../docs/assets/styles.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../docs/assets/app.js', import.meta.url), 'utf8');
const built = () => buildRecords(demoSheets(), messages);
const find = (records, number) => records.find((r) => r.number === number).payload;

test('greeting keeps compound given names and drops initials', () => {
  assert.equal(greetingName('Mary Joyce N.'), 'Mary Joyce');
  assert.equal(greetingName('Kyle Iñigo S.'), 'Kyle Iñigo');
  assert.equal(greetingName('Alexandrin Margarette'), 'Alexandrin Margarette');
  assert.equal(greetingName('Jonnel'), 'Jonnel');
});

test('numbers round to two places without trailing zeros', () => {
  assert.equal(formatNumber(86.456), '86.46');
  assert.equal(formatNumber(40), '40');
  assert.equal(formatNumber('2.0'), '2.0');
});

test('every demo student becomes a record with exact headings', () => {
  const { records, blocking } = built();
  assert.deepEqual(blocking, []);
  assert.equal(records.length, DEMO_STUDENTS.length);
  const first = find(records, '1000000001');
  assert.equal(first.greetingName, 'Ana Maria');
  assert.equal(first.terms[0].items[1].label, 'MT Quiz 2 (Sketch)');
  assert.equal(first.terms[1].items[3].label, 'FT Project (Guitar Performance)');
  assert.equal(first.terms[0].grade.label, 'MT Grade');
  assert.deepEqual(first.summary.map((s) => s.label), ['(MTG + FTG)/2', 'Equivalent', 'Remarks']);
  assert.ok(!JSON.stringify(first).includes('For Encoding'));
  assert.ok(!JSON.stringify(first).includes('1000000001'));
});

test('blank red scores are published as missing', () => {
  const { records } = built();
  const student = find(records, '1000000005');
  assert.equal(student.terms[1].items[1].score, null);
  assert.ok(student.interpretation.some((i) => i.heading === messages.headings.missing));
  assert.ok(!student.interpretation.some((i) => i.heading === messages.headings.trend));
  assert.match(find(records, '1000000006').interpretation[0].text, /will receive INC/);
  assert.equal(find(records, '1000000006').summary[1].value, 'INC', 'Incomplete never shows a numeric grade');
  const inc = find(records, '1000000006').interpretation;
  assert.equal(inc.find((i) => i.kind === 'completion').steps.length, 6, 'INC students get the completion steps');
  assert.ok(inc.some((i) => i.kind === 'receiving'), 'INC students are told to keep a receiving copy');
  assert.ok(!find(records, '1000000005').interpretation.some((i) => i.kind === 'completion'), 'only INC records get the steps');
  assert.doesNotMatch(JSON.stringify(records), /may change|late submissions are no longer/, 'no wording that grades may still change');
});

test('ungraded scores show a note instead of the record', () => {
  const { records, pending } = built();
  assert.deepEqual(pending, ['DEMO1A row 9: FT Project (Guitar Performance)']);
  const student = find(records, '1000000007');
  assert.equal(student.status, 'pending');
  assert.equal(student.terms, undefined, 'no scores are sent');
  assert.equal(student.summary, undefined, 'no grade is sent');
  assert.equal(student.interpretation.length, 1);
  assert.match(student.interpretation[0].text, /^Sorry, Bea, I'm still grading your Guitar Performance/);
  assert.ok(records.find((r) => r.number === '1000000007').pending);
  assert.ok(!records.find((r) => r.number === '1000000005').pending);
});

test('dropped students are never left waiting', () => {
  const sheets = demoSheets();
  sheets[0].cells.set('U9', { value: 'Dropped' });
  const { records, pending } = buildRecords(sheets, messages);
  assert.deepEqual(pending, []);
  assert.match(find(records, '1000000007').interpretation[0].text, /marked Dropped/);
});

test('red fills are read from the workbook styles', () => {
  const styles = '<styleSheet><fills count="3"><fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
    + '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" applyFill="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="1" borderId="0"></xf></cellXfs></styleSheet>';
  assert.deepEqual([...redStyles(styles)], [1]);
  assert.deepEqual([...redStyles(undefined)], []);
});

test('workbook mistakes block publishing', () => {
  const duplicate = demoSheets();
  duplicate[0].cells.set('D4', { value: '1000000001' });
  assert.ok(buildRecords(duplicate, messages).blocking.some((p) => p.includes('same student number')));

  const short = demoSheets();
  short[0].cells.set('D3', { value: '12345' });
  assert.ok(buildRecords(short, messages).blocking.some((p) => p.includes('10 digits')));

  const high = demoSheets();
  high[0].cells.set('E3', { value: 41 });
  assert.ok(buildRecords(high, messages).blocking.some((p) => p.includes('outside 0 to 40')));

  const broken = demoSheets();
  broken[0].cells.set('S3', { value: '#DIV/0!', error: true });
  assert.ok(buildRecords(broken, messages).blocking.some((p) => p.includes('no calculated result')));

  const moved = demoSheets();
  moved[0].cells.set('T1', { value: 'Grade' });
  assert.ok(buildRecords(moved, messages).blocking.some((p) => p.includes('should be "Equivalent"')));
});

const term = (scores, grade) => ({
  grade: { value: grade },
  items: scores.map(([label, score, max]) => ({ label, score, max })),
});

test('interpretation follows the rule table', () => {
  const terms = [
    term([['MT Quiz 1', 40, 40], ['MT Exams', 25, 50], ['MT Attendance', 10, 100]], 80),
    term([['FT Exams', 40, 50]], 90),
  ];
  const result = interpret({ name: 'Ana', terms, equivalent: '1.5', remarks: 'Passed' }, messages);
  const text = (heading) => result.find((r) => r.heading === messages.headings[heading])?.text;
  assert.match(text('overall'), /Excellent work, Ana/);
  assert.match(text('strength'), /MT Quiz 1, at 100%/);
  assert.match(text('focus'), /MT Exams, at 50%/);
  assert.match(text('trend'), /rose by 10 points/);
  assert.ok(!JSON.stringify(result).includes('Attendance'), 'attendance is left out of comparisons');
  assert.deepEqual(result.map((r) => r.kind), ['overall', 'strength', 'focus', 'trend']);
});

test('every equivalent has an overall message', () => {
  for (const equivalent of ['1', '1.25', '1.5', '1.75', '2.0', '2.25', '2.5', '2.75', '3', '5']) {
    const terms = [term([['A', 1, 2]], 80), term([['B', 1, 2]], 80)];
    const result = interpret({ name: 'Ana', terms, equivalent, remarks: 'Passed' }, messages);
    assert.equal(result[0].heading, messages.headings.overall, `missing band for ${equivalent}`);
  }
});

test('failing, steady, ties and special remarks read correctly', () => {
  const tied = [term([['A', 10, 10], ['B', 10, 10]], 80), term([['C', 10, 10]], 81)];
  const result = interpret({ name: 'Ana', terms: tied, equivalent: '5', remarks: 'Failed' }, messages);
  assert.match(result[0].text, /below the passing mark/);
  assert.match(result[1].text, /A, B, and C/);
  assert.ok(!result.some((r) => r.heading === messages.headings.focus), 'no focus area when all scores tie');
  assert.match(result.at(-1).text, /stayed steady/);

  const inc = interpret({ name: 'Ana', terms: tied, equivalent: '5', remarks: 'Incomplete' }, messages);
  assert.match(inc[0].text, /will receive INC/);
});

const FAST_KDF = { memoryKiB: 1024, passes: 1 };
const VENDOR = new URL('../docs/assets/vendor/argon2.umd.min.js', import.meta.url);
const VENDOR_SHA256 = 'acfe11b015852f593aaddc51116f71dc7850e4551e6b34d42c1f88cf39635f03';

test('the vendored Argon2 file is the reviewed hash-wasm 4.13.0 build', () => {
  assert.equal(createHash('sha256').update(readFileSync(VENDOR)).digest('hex'), VENDOR_SHA256);
});

test('the browser and the publisher derive identical keys', async () => {
  // Load it exactly as the page does: a classic script that sets globalThis.hashwasm.
  runInThisContext(readFileSync(VENDOR, 'utf8'), { filename: 'argon2.umd.min.js' });
  const { argon2id } = globalThis.hashwasm;
  const salt = Buffer.from('demo-salt-16byte').toString('base64');
  for (const number of ['2025000001', '2026110350']) {
    const node = await deriveRecordKeys(number, salt, FAST_KDF);
    const browser = await argon2id({
      password: number, salt: Buffer.from(salt, 'base64'), parallelism: 1,
      iterations: FAST_KDF.passes, memorySize: FAST_KDF.memoryKiB, hashLength: 48, outputType: 'binary',
    });
    assert.equal(Buffer.from(browser.slice(0, 32)).toString('hex'), node.key.toString('hex'));
    assert.equal(Buffer.from(browser.slice(32)).toString('hex'), node.id);
  }
});

test('the site uses a strong Argon2id setting and a fresh salt', () => {
  const site = JSON.parse(readFileSync(new URL('../config/site.json', import.meta.url)));
  assert.ok(site.kdf.memoryKiB >= 131072, 'at least 128 MB per guess');
  assert.ok(site.kdf.passes >= 5);
  assert.equal(Buffer.from(site.salt, 'base64').length, 16);
  assert.notEqual(site.salt, 'dCdQIju0CsVIhUKgG4b9/A==', 'the old salt is retired');
  assert.match(page, /script-src 'self' 'wasm-unsafe-eval';/, 'only same-site scripts plus WebAssembly');
  assert.doesNotMatch(page, /unsafe-inline|https?:\/\/(?!www\.facebook\.com)/, 'no inline scripts or outside sources');
});

test('records open only with the right student number', async () => {
  const salt = Buffer.from('demo-salt-16byte').toString('base64');
  const right = await deriveRecordKeys('2025000001', salt, FAST_KDF);
  const wrong = await deriveRecordKeys('2025000002', salt, FAST_KDF);
  assert.notEqual(right.id, wrong.id);
  const file = encryptRecord({ greetingName: 'Iñigo' }, right.key, right.id);
  assert.deepEqual(decryptRecord(file, right.key, right.id), { greetingName: 'Iñigo' });
  assert.ok(!file.toString('latin1').includes('Inigo'));
  assert.throws(() => decryptRecord(file, wrong.key, right.id));
  const tampered = Buffer.from(file);
  tampered[20] ^= 1;
  assert.throws(() => decryptRecord(tampered, right.key, right.id));
});

test('zip reader handles compressed entries', () => {
  const name = Buffer.from('a.txt');
  const data = deflateRawSync(Buffer.from('hello'));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  assert.equal(unzip(zip).get('a.txt').toString(), 'hello');
});

test('xml text is decoded once', () => {
  assert.equal(decodeXml('A &amp; B &#241; &amp;lt;'), 'A & B ñ &lt;');
});

test('the stylesheet is built only from the four approved colors', () => {
  const allowed = new Set(['#002C39', '#015061', '#00C18E', '#FFF7F7']);
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const used = noComments.match(/#[0-9a-fA-F]{3,8}\b/g).map((c) => c.toUpperCase());
  assert.deepEqual([...new Set(used)].filter((c) => !allowed.has(c)), []);
  assert.doesNotMatch(noComments, /rgba?\(|hsla?\(|\bopacity: 0/);
});

test('the page and script add no other colors', () => {
  const allowed = new Set(['#002C39', '#015061', '#00C18E', '#FFF7F7']);
  const used = `${page}\n${script}`.match(/#[0-9a-fA-F]{6}\b/g).map((c) => c.toUpperCase());
  assert.deepEqual([...new Set(used)].filter((c) => !allowed.has(c)), []);
});

test('older phones get solid panels and a number pad', () => {
  const fallback = css.match(/@supports not \(color: color-mix\([^)]*\)\) \{([\s\S]*?)\n\}/);
  assert.ok(fallback, 'missing the solid fallback for browsers without color-mix');
  for (const token of ['glass', 'hero', 'stat', 'term-head', 'hero-plane', 'row-line']) {
    assert.equal((fallback[1].match(new RegExp(`--${token}: var\\(--`, 'g')) ?? []).length, 2, `--${token} needs a solid value in both themes`);
  }
  assert.doesNotMatch(css, /\binset: 0/);
  assert.match(page, /inputmode="numeric" pattern="\[0-9\]\*"/);
});

test('every icon the record uses exists on the page', () => {
  const names = [...script.matchAll(/'(pencil|cup|mask|guitar|camera|exam|calendar|quiz|award|alert|star|target|trend|check)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 14);
  for (const name of new Set(names)) assert.ok(page.includes(`id="i-${name}"`), `missing icon ${name}`);
});

const luminance = (hex) => {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const hexOf = { deep: '#002C39', teal: '#015061', mint: '#00C18E', blush: '#FFF7F7' };

/** Reads "--name: color-mix(in srgb, var(--color) N%, transparent)" from a theme block. */
const glassToken = (block, name) => {
  const found = block.match(new RegExp(`--${name}: color-mix\\(in srgb, var\\(--(\\w+)\\) (\\d+)%, transparent\\)`));
  return { color: hexOf[found[1]], amount: Number(found[2]) / 100 };
};

const blend = ({ color, amount }, behind) => {
  const channel = (i) => Math.round(
    parseInt(color.slice(i, i + 2), 16) * amount + parseInt(behind.slice(i, i + 2), 16) * (1 - amount),
  ).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
};

test('text stays readable through glass over anything behind it', () => {
  const [light, dark] = css.split(':root[data-theme="dark"] {');
  const behind = Object.values(hexOf);
  const checks = [
    [light, 'glass', [hexOf.deep, hexOf.teal], [hexOf.blush, hexOf.mint, hexOf.teal]],
    [light, 'hero', [hexOf.blush], behind],
    [light, 'stat', [hexOf.blush], behind],
    [light, 'term-head', [hexOf.blush], behind],
    [dark, 'glass', [hexOf.blush], [hexOf.deep, hexOf.mint, hexOf.teal]],
    [dark, 'hero', [hexOf.blush], [hexOf.deep, hexOf.mint, hexOf.teal]],
    [dark, 'stat', [hexOf.blush], [hexOf.deep, hexOf.mint, hexOf.teal]],
    [dark, 'term-head', [hexOf.blush], [hexOf.deep, hexOf.mint, hexOf.teal]],
  ];
  for (const [block, name, inks, backgrounds] of checks) {
    const token = glassToken(block, name);
    for (const ink of inks) {
      for (const background of backgrounds) {
        const surface = blend(token, background);
        assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${name} over ${background}: ${contrast(ink, surface).toFixed(2)}`);
      }
    }
  }
});

test('text color pairs meet WCAG AA in both themes', () => {
  const [deep, teal, mint, blush] = ['#002C39', '#015061', '#00C18E', '#FFF7F7'];
  const pairs = [
    [deep, blush], [teal, blush], [deep, mint], // light theme
    [blush, deep], [mint, deep], [blush, teal], // dark theme
  ];
  for (const [text, background] of pairs) {
    assert.ok(contrast(text, background) >= 4.5, `${text} on ${background}: ${contrast(text, background).toFixed(2)}`);
  }
});
