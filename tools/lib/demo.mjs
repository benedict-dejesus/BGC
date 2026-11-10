// Made-up students for previewing and testing. No real person's data.
const HEADERS = {
  A: 'Count', B: 'Surname', C: 'Given Name', D: 'Student Number',
  E: 'MT Quiz 1', F: 'MT Quiz 2 (Sketch)', G: 'MT Activity (Coffee Painting Workshop)',
  H: 'MT Project (Coffee Painting Self-Portrait)', I: 'MT Exams', J: 'MT Attendance', K: 'MT Grade',
  L: 'FT Quiz 1 (Theater Play Viewing)', M: 'FT Quiz 2 (Guitar Workshop)',
  N: 'FT Activity (Photography Activity)', O: 'FT Project (Guitar Performance)',
  P: 'FT Exams', Q: 'FT Attendance', R: 'FT Grade', S: '(MTG + FTG)/2',
  T: 'Equivalent', U: 'Remarks', V: 'For Encoding',
};
const MAX = { E: 40, F: 40, G: 100, H: 100, I: 50, J: 100, L: 40, M: 40, N: 100, O: 100, P: 50, Q: 100 };

const termGrade = (s, [q1, q2, act, proj, exam, att]) =>
  (s[q1] ?? 0) / 40 * 10 + (s[q2] ?? 0) / 40 * 10 + (s[act] ?? 0) * 0.2 + (s[proj] ?? 0) * 0.2
  + (s[exam] ?? 0) / 50 * 30 + (s[att] ?? 0) * 0.1;

function equivalent(average) {
  const bands = [[96.5, '1'], [93.5, '1.25'], [90.5, '1.5'], [87.5, '1.75'], [84.5, '2.0'],
    [81.5, '2.25'], [78.5, '2.5'], [75.5, '2.75'], [74.5, '3']];
  return bands.find(([min]) => average >= min)?.[1] ?? '5';
}

const score = (mt, ft) => ({
  E: mt[0], F: mt[1], G: mt[2], H: mt[3], I: mt[4], J: mt[5],
  L: ft[0], M: ft[1], N: ft[2], O: ft[3], P: ft[4], Q: ft[5],
});

export const DEMO_STUDENTS = [
  { surname: 'Sample', given: 'Ana Maria T.', number: '1000000001', scores: score([39, 40, 100, 98, 48, 100], [38, 40, 99, 100, 49, 100]) },
  { surname: 'Dela Prueba', given: 'Juan Iñigo R.', number: '1000000002', scores: score([31, 35, 85, 88, 39, 95], [36, 38, 92, 94, 44, 100]) },
  { surname: 'Ejemplo', given: 'Mika', number: '1000000003', scores: score([28, 30, 80, 82, 36, 90], [27, 31, 78, 80, 34, 90]) },
  { surname: 'Muestra Jr.', given: 'Paolo S.', number: '1000000004', scores: score([20, 22, 60, 55, 21, 80], [18, 24, 58, 40, 20, 70]) },
  // Blank red cells: did not submit. Blank cells without red: not graded yet.
  { surname: 'Halimbawa', given: 'Rosa Lyn C.', number: '1000000005', red: ['M', 'O'], scores: score([33, 36, 90, 85, 40, 100], [35, undefined, 88, undefined, 41, 100]) },
  { surname: 'Pagsubok', given: 'Leo D.', number: '1000000006', remarks: 'Incomplete', red: ['O', 'P'], scores: score([30, 32, 85, 80, 35, 90], [30, 33, 80, undefined, undefined, 80]) },
  { surname: 'Hinihintay', given: 'Bea M.', number: '1000000007', scores: score([34, 35, 92, 96, 42, 100], [36, 37, 95, undefined, 44, 100]) },
];

export function demoSheets() {
  const cells = new Map();
  const set = (ref, value) => { if (value !== undefined) cells.set(ref, { value }); };
  for (const [column, label] of Object.entries(HEADERS)) set(`${column}1`, label);
  for (const [column, max] of Object.entries(MAX)) set(`${column}2`, max);

  DEMO_STUDENTS.forEach((student, index) => {
    const row = index + 3;
    set(`A${row}`, index + 1);
    set(`B${row}`, student.surname);
    set(`C${row}`, student.given);
    set(`D${row}`, student.number);
    for (const [column, value] of Object.entries(student.scores)) set(`${column}${row}`, value);
    for (const column of student.red ?? []) cells.set(`${column}${row}`, { value: undefined, red: true });
    const mt = termGrade(student.scores, ['E', 'F', 'G', 'H', 'I', 'J']);
    const ft = termGrade(student.scores, ['L', 'M', 'N', 'O', 'P', 'Q']);
    const average = (mt + ft) / 2;
    const grade = equivalent(average);
    set(`K${row}`, mt);
    set(`R${row}`, ft);
    set(`S${row}`, average);
    set(`T${row}`, grade);
    set(`U${row}`, student.remarks ?? (Number(grade) <= 3 ? 'Passed' : 'Failed'));
  });
  return [{ name: 'DEMO1A', cells }];
}
