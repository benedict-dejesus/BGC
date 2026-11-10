// Turns the section sheets of Main Class Record into one record per student.
import { interpret, fill } from './interpret.mjs';

const FIRST_ROW = 3;
const LAST_ROW = 63;
const MAX_ROW = 2;
const HEADER_ROW = 1;

const EXPECTED_HEADERS = {
  B: 'Surname', C: 'Given Name', D: 'Student Number',
  K: 'MT Grade', R: 'FT Grade', T: 'Equivalent', U: 'Remarks',
};

export const TERMS = [
  { title: 'Midterm', scores: ['E', 'F', 'G', 'H', 'I', 'J'], grade: 'K' },
  { title: 'Finals', scores: ['L', 'M', 'N', 'O', 'P', 'Q'], grade: 'R' },
];
const SUMMARY = { average: 'S', equivalent: 'T', remarks: 'U' };

const text = (value) => (value === undefined || value === null ? '' : String(value).trim());

/** "Mary Joyce N." -> "Mary Joyce". Compound given names stay whole. */
export function greetingName(givenName) {
  const words = text(givenName).split(/ +/);
  while (words.length > 1 && /^[A-Za-z]\.?$/.test(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function formatNumber(value) {
  if (typeof value !== 'number') return text(value);
  return String(Math.round(value * 100) / 100);
}

/** "FT Project (Guitar Performance)" -> "Guitar Performance". Labels without brackets stay whole. */
export function shortLabel(label) {
  return label.match(/\(([^)]+)\)/)?.[1] ?? label;
}

function joinList(items) {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Returns { records, blocking, pending }.
 * blocking: problems that always stop a publish.
 * pending: blank cells that are not red, meaning not graded yet. A student with any of these
 *   gets a short "not ready yet" note instead of scores, unless their record is Dropped.
 *   A blank red cell means the student did not submit, so it is published as a missing score.
 */
export function buildRecords(sheets, messages) {
  const records = [];
  const blocking = [];
  const pending = [];
  const seen = new Map();

  for (const sheet of sheets) {
    const cell = (ref) => sheet.cells.get(ref);
    const value = (ref) => cell(ref)?.value;

    for (const [column, expected] of Object.entries(EXPECTED_HEADERS)) {
      if (text(value(`${column}${HEADER_ROW}`)) !== expected) {
        blocking.push(`${sheet.name}!${column}${HEADER_ROW} should be "${expected}" but is "${text(value(`${column}${HEADER_ROW}`))}".`);
      }
    }

    for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
      const surname = text(value(`B${row}`));
      const given = text(value(`C${row}`));
      const number = text(value(`D${row}`));
      if (!surname && !given && !number) continue;

      const where = `${sheet.name} row ${row}`;
      if (!surname || !given || !number) {
        blocking.push(`${where}: surname, given name or student number is missing.`);
        continue;
      }
      if (!/^\d{10}$/.test(number)) blocking.push(`${where}: student number is not 10 digits.`);
      if (seen.has(number)) blocking.push(`${where}: same student number as ${seen.get(number)}.`);
      seen.set(number, where);

      const remarks = text(value(`${SUMMARY.remarks}${row}`));
      const ungraded = [];
      const terms = TERMS.map((term) => ({
        title: term.title,
        items: term.scores.map((column) => {
          const score = value(`${column}${row}`);
          const max = value(`${column}${MAX_ROW}`);
          const label = text(value(`${column}${HEADER_ROW}`));
          if (cell(`${column}${row}`)?.error) blocking.push(`${where}: ${label} shows ${score}.`);
          else if (score === undefined || text(score) === '') {
            if (!cell(`${column}${row}`)?.red && remarks !== 'Dropped') ungraded.push(label);
          }
          else if (typeof score !== 'number') blocking.push(`${where}: ${label} is not a number.`);
          else if (score < 0 || score > max) blocking.push(`${where}: ${label} is ${score}, outside 0 to ${max}.`);
          return { label, score: typeof score === 'number' ? score : null, max };
        }),
        grade: {
          label: text(value(`${term.grade}${HEADER_ROW}`)),
          value: value(`${term.grade}${row}`),
        },
      }));

      for (const column of [...TERMS.map((t) => t.grade), ...Object.values(SUMMARY)]) {
        const target = cell(`${column}${row}`);
        if (!target || target.error) blocking.push(`${where}: ${column}${row} has no calculated result.`);
      }

      const plainNames = [`${surname}, ${given}`, `${given} ${surname}`];
      if (ungraded.length) {
        pending.push(...ungraded.map((label) => `${where}: ${label}`));
        records.push({
          number,
          pending: true,
          payload: {
            status: 'pending',
            greetingName: greetingName(given),
            fullName: `${given} ${surname}`,
            section: sheet.name,
            interpretation: [{
              kind: 'pending',
              heading: messages.headings.pending,
              text: fill(messages.pending, {
                name: greetingName(given),
                components: joinList(ungraded.map(shortLabel)),
              }),
            }],
          },
          plainNames,
        });
        continue;
      }

      const equivalent = text(value(`${SUMMARY.equivalent}${row}`));
      const interpretation = interpret({
        name: greetingName(given), terms, equivalent, remarks,
      }, messages);

      records.push({
        number,
        payload: {
          greetingName: greetingName(given),
          fullName: `${given} ${surname}`,
          section: sheet.name,
          terms: terms.map((term) => ({
            title: term.title,
            items: term.items,
            grade: { label: term.grade.label, value: formatNumber(term.grade.value) },
          })),
          summary: [
            { label: text(value(`${SUMMARY.average}${HEADER_ROW}`)), value: formatNumber(value(`${SUMMARY.average}${row}`)) },
            // An Incomplete record has no final grade yet, so it never shows the calculated 5.
            { label: text(value(`${SUMMARY.equivalent}${HEADER_ROW}`)), value: remarks === 'Incomplete' ? 'INC' : equivalent },
            { label: text(value(`${SUMMARY.remarks}${HEADER_ROW}`)), value: remarks },
          ],
          interpretation,
        },
        plainNames,
      });
    }
  }
  return { records, blocking, pending };
}
