// Minimal, dependency-free .xlsx reader. It reads the values Excel last saved,
// including calculated results, and can read a workbook that is open in Excel.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file: zip directory not found.');
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new Error('Corrupt zip directory.');
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (!name.endsWith('/')) files.set(name, method === 0 ? raw : inflateRawSync(raw));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => {
    const body = (m[1] ?? '').replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    return [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
  });
}

/**
 * Returns the cell style numbers whose fill is solid red (Excel's standard red, FF0000).
 * In the class record, a blank red cell means the student did not submit.
 */
export function redStyles(xml) {
  if (!xml) return new Set();
  const fills = [...(xml.match(/<fills[\s\S]*?<\/fills>/)?.[0] ?? '').matchAll(/<fill>([\s\S]*?)<\/fill>|<fill\/>/g)]
    .map((m) => /patternType="solid"/.test(m[1] ?? '') && /<fgColor rgb="FFFF0000"/i.test(m[1] ?? ''));
  const xfs = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  const red = new Set();
  [...xfs.matchAll(/<xf\s[^>]*>/g)].forEach((m, index) => {
    if (fills[Number(attr(m[0], 'fillId') ?? 0)]) red.add(index);
  });
  return red;
}

function parseSheet(xml, shared, red = new Set()) {
  const cells = new Map();
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(` ${m[1]}`, 'r');
    const type = attr(` ${m[1]}`, 't');
    const body = m[2] ?? '';
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (type === 'inlineStr') {
      cells.set(ref, { value: [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('') });
    } else if (raw === undefined) {
      if (red.has(Number(attr(` ${m[1]}`, 's')))) cells.set(ref, { value: undefined, red: true });
    } else if (type === 's') {
      cells.set(ref, { value: shared[Number(raw)] });
    } else if (type === 'str') {
      cells.set(ref, { value: decodeXml(raw) });
    } else if (type === 'e') {
      cells.set(ref, { value: decodeXml(raw), error: true });
    } else if (type === 'b') {
      cells.set(ref, { value: raw === '1' });
    } else {
      cells.set(ref, { value: Number(raw) });
    }
  }
  return cells;
}

/**
 * Returns [{ name, cells: Map('A1' -> { value, error?, red? }) }] in workbook order.
 * Blank cells are left out, except blank red ones, which come back as { value: undefined, red: true }.
 */
export function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const text = (name) => files.get(name)?.toString('utf8');
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));
  const red = redStyles(text('xl/styles.xml'));
  const rels = new Map();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)) {
    rels.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
  }
  return [...text('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)].map((m) => {
    const target = rels.get(attr(m[0], 'r:id')).replace(/^\/?(xl\/)?/, '');
    return { name: decodeXml(attr(m[0], 'name')), cells: parseSheet(text(`xl/${target}`), shared, red) };
  });
}
