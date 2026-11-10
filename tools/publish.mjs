#!/usr/bin/env node
// Reads the saved Main Class Record and writes one encrypted file per student.
//
//   npm run publish                  real data into docs/data
//   npm run publish -- --allow-pending  publish while some scores are still ungraded
//   npm run demo                     made-up students into .demo/ (never published)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync, writeFileSync, cpSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx.mjs';
import { buildRecords } from './lib/records.mjs';
import { deriveRecordKeys, encryptRecord, decryptRecord } from './lib/crypto.mjs';
import { demoSheets } from './lib/demo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'docs');
const CONCURRENCY = 8;
const SHOWN_PROBLEMS = 15;

function parseArgs(argv) {
  const args = { demo: false, allowPending: false, source: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--demo') args.demo = true;
    else if (argv[i] === '--allow-pending') args.allowPending = true;
    else if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return args;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function loadLocalSettings() {
  const path = join(ROOT, 'tools', 'publish.local.json');
  return existsSync(path) ? readJson(path) : {};
}

function stop(title, problems = []) {
  console.error(`\nNothing was published. ${title}`);
  problems.slice(0, SHOWN_PROBLEMS).forEach((problem) => console.error(`  - ${problem}`));
  if (problems.length > SHOWN_PROBLEMS) console.error(`  ...and ${problems.length - SHOWN_PROBLEMS} more.`);
  process.exit(1);
}

function summarizeBlanks(blanks) {
  const counts = new Map();
  for (const blank of blanks) {
    const label = blank.split(': ').slice(1).join(': ');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${label}: blank for ${count} student(s)`);
}

async function inBatches(items, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    results.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(worker)));
  }
  return results;
}

function walk(dir, skip = new Set()) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, skip) : [path];
  });
}

/** Fails if any real name or student number can be read in the given files. */
export function findPlainData(files, records) {
  const needles = records.flatMap((record) => [record.number, ...record.plainNames]);
  const leaks = [];
  for (const file of files) {
    if (['.woff2', '.xlsx'].includes(extname(file))) continue;
    const content = readFileSync(file).toString('latin1') + readFileSync(file).toString('utf8');
    if (needles.some((needle) => content.includes(needle))) leaks.push(file);
  }
  return leaks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadLocalSettings();
  const site = readJson(join(ROOT, 'config', 'site.json'));
  const messages = readJson(join(ROOT, 'config', 'messages.json'));

  let sheets;
  if (args.demo) {
    sheets = demoSheets();
  } else {
    const source = args.source ?? settings.source;
    if (!source) stop('Set "source" in tools/publish.local.json or pass --source "path to workbook".');
    if (!existsSync(source)) stop(`Workbook not found: ${source}`);
    const lock = join(dirname(source), `~$${basename(source)}`);
    if (existsSync(lock)) console.log('Note: the workbook is open in Excel. Only its last saved version is used.');
    sheets = readWorkbook(source);
  }

  const { records, blocking, pending } = buildRecords(sheets, messages);
  if (blocking.length) stop('Fix these in the workbook first:', blocking);
  const expected = args.demo ? null : settings.expectedStudents;
  if (expected && records.length !== expected) {
    stop(`Found ${records.length} students, but expected ${expected}. Update "expectedStudents" if the class list changed.`);
  }
  if (pending.length && !args.demo && !args.allowPending) {
    stop(
      'Some scores are blank but not marked red, so they look ungraded. Finish grading, mark non-submissions red, or use --allow-pending to show those students a "not ready yet" note.',
      summarizeBlanks(pending),
    );
  }

  const out = resolve(args.out ?? (args.demo ? join(ROOT, '.demo') : SITE));
  if (args.demo || args.out) {
    rmSync(out, { recursive: true, force: true });
    cpSync(SITE, out, { recursive: true, filter: (path) => !path.includes(`${join('docs', 'data')}`) });
  }

  const staging = join(out, '.data-staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'records'), { recursive: true });

  console.log(`Encrypting ${records.length} student records...`);
  const written = await inBatches(records, async (record) => {
    const { key, id } = await deriveRecordKeys(record.number, site.salt, site.kdf);
    const path = join(staging, 'records', `${id}.bin`);
    writeFileSync(path, encryptRecord(record.payload, key, id));
    return { record, key, id, path };
  });

  if (new Set(written.map((item) => item.id)).size !== records.length) stop('Two records produced the same file name.');
  for (const { record, key, id, path } of written) {
    const opened = decryptRecord(readFileSync(path), key, id);
    if (JSON.stringify(opened) !== JSON.stringify(record.payload)) stop(`A record failed its read-back check (${id}).`);
  }

  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify({
    version: 2,
    salt: site.salt,
    kdf: { name: 'argon2id', memoryKiB: site.kdf.memoryKiB, passes: site.kdf.passes },
    course: site.course,
    term: site.term,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  const leaks = findPlainData(walk(staging), records);
  if (leaks.length) {
    rmSync(staging, { recursive: true, force: true });
    stop('Readable student data was found in the output.', leaks);
  }

  rmSync(join(out, 'data'), { recursive: true, force: true });
  renameSync(staging, join(out, 'data'));

  const repoLeaks = args.demo ? [] : findPlainData(
    walk(ROOT, new Set(['.git', 'node_modules', '.demo', 'publish.local.json'])), records,
  );
  if (repoLeaks.length) stop('Readable student data was found in the repository.', repoLeaks);

  console.log(`Done. ${records.length} records written to ${join(out, 'data')}.`);
  const waiting = records.filter((record) => record.pending).length;
  if (waiting) console.log(`Students who see their scores: ${records.length - waiting}. Students who see the "not ready yet" note: ${waiting}.`);
  console.log('All records were read back successfully, and no readable student data was found.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => stop(error.message));
}
