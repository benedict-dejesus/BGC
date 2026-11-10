# BGC: Benedict's Grade Consultation

A private-by-default web app for asynchronous grade consultation. A student enters their
student number and sees a personal greeting, their scores, and a rule-based interpretation.
There is no AI and no server: the site is plain files on GitHub Pages.

## How it works

1. The class record workbook stays on the teacher's PC and never enters this repository.
2. `npm run publish` reads the last saved workbook and writes one encrypted file per student.
3. The student's browser turns their student number into a key and a file name, then opens
   only that file. The site contains no readable names, scores, or student numbers.

## Publish or update grades

Save the workbook in Excel, then run:

```bash
npm run publish
```

The publish stops without changing the site if it finds formula errors, duplicate or malformed
student numbers, scores above the maximum, moved columns, or a different student count.

Blank scores are read by their fill color:

- **Blank with red fill** means the student did not submit. It is published as a missing score.
- **Blank without fill** means the score is not graded yet. The publish stops, unless you run
  `npm run publish -- --allow-pending`. Then each student with an ungraded score sees only a
  short "not ready yet" note, with no scores or grade, until you grade it and publish again.
  Dropped students always see their record.

Then commit `docs/data` and push. GitHub Pages can take a few minutes to update.

The workbook path and expected student count are in `tools/publish.local.json`, which is not
committed:

```json
{ "source": "C:/path/to/Main Class Record.xlsx", "expectedStudents": 564 }
```

## Change the interpretation wording

Edit `config/messages.json`, then publish again. `{name}`, `{components}`, `{percent}` and
`{points}` are filled in for each student.

| Message | Rule |
|---|---|
| Not ready yet (`pending`) | Any blank score without red fill, shown instead of the record |
| Overall | Based on the Equivalent band, or the Remarks if Incomplete or Dropped |
| Missing scores | Any blank score |
| Strongest area | Highest score as a percentage of its maximum |
| Area to focus on | Lowest score as a percentage of its maximum |
| Midterm to Finals | FT Grade minus MT Grade, with 3 points or less counted as steady |

Attendance is left out of the strongest and lowest comparison.

## Preview with made-up students

```bash
npm run demo
```

Open http://localhost:4173 and use `1000000001` to `1000000007`. `1000000007` shows the "not ready yet" note. Demo files go to `.demo/`,
which is never committed.

## Set up GitHub Pages

1. Create a GitHub repository and push this one to it.
2. In the repository, open Settings, then Pages.
3. Under Build and deployment, choose Deploy from a branch, then `main` and `/docs`.

## Take the site down

When consultation ends, turn off Pages and delete the repository, which also removes the
encrypted records from its history.

## Privacy limits

Records are encrypted, but the student number is the only key. Anyone who has a student's
number can open that student's record.

Each record is locked with Argon2id (128 MB of memory, 5 passes, settings in `config/site.json`),
so every guess at a student number costs about a second and a lot of memory, which also blunts
graphics cards. Student numbers follow a predictable format (about 330,000 possibilities), so
someone determined could still download the files and try every number offline. That takes
roughly half a day to a day of a laptop running nonstop. This design slows that down but does
not stop it. Removing the site after consultation limits this risk.

The page's JavaScript is necessarily readable by any browser that opens it. That is fine:
the protection comes from the student number, not from hiding the code. The Argon2 code is
`docs/assets/vendor/argon2.umd.min.js` from hash-wasm 4.13.0 (MIT, see
`hash-wasm-LICENSE.txt`). `npm test` checks its SHA-256 and that it derives exactly the same
keys as the publisher, so a swapped file is caught.

Changing `salt` in `config/site.json` and publishing again makes all old record files useless.

## Colors

The interface is built only from `#002C39`, `#015061`, `#00C18E` and `#FFF7F7`. Glass panels are
translucent versions of these, so tints appear where they overlap. `npm test` fails if any other
color enters the page, and checks text contrast through the glass in both themes.

## Tests

```bash
npm test
```

Fonts: Bricolage Grotesque and Atkinson Hyperlegible, under the SIL Open Font License. They are
served from this site, so student browsers make no third-party requests.
