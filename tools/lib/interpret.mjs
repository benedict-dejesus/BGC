// Rule-based interpretation. No AI: every sentence comes from config/messages.json.

const MAX_LISTED = 3;

export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function joinList(items) {
  if (items.length < 2) return items.join('');
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function describeGroup(group, templates, percent) {
  const listed = group.slice(0, MAX_LISTED).map((item) => item.label);
  const template = group.length === 1 ? templates.one : templates.many;
  return fill(template, { components: joinList(listed), percent });
}

function overallMessage({ name, equivalent, remarks }, messages) {
  const special = messages.remarks[remarks];
  if (special) return fill(special, { name });
  const grade = Number(equivalent);
  const band = messages.overall.find((entry) => grade >= entry.from && grade <= entry.to);
  return band ? fill(band.text, { name }) : '';
}

export function interpret(student, messages) {
  const { terms } = student;
  const result = [];
  const add = (kind, text) => { if (text) result.push({ kind, heading: messages.headings[kind], text }); };

  add('overall', overallMessage(student, messages));
  if (student.remarks === 'Incomplete' && messages.completion) {
    result.push({ kind: 'completion', heading: messages.headings.completion, text: '', steps: messages.completion.steps });
    add('receiving', messages.completion.receiving);
  }

  const allItems = terms.flatMap((term) => term.items);
  const missing = allItems.filter((item) => item.score === null);
  if (missing.length) {
    add('missing', fill(
      missing.length === 1 ? messages.missing.one : messages.missing.many,
      { components: joinList(missing.map((item) => item.label)) },
    ));
  }

  const compared = allItems
    .filter((item) => item.score !== null)
    .filter((item) => !messages.leaveOutOfComparison.some((word) => item.label.includes(word)))
    .map((item) => ({ ...item, percent: Math.round((item.score / item.max) * 100) }));

  if (compared.length) {
    const highest = Math.max(...compared.map((item) => item.percent));
    const lowest = Math.min(...compared.map((item) => item.percent));
    add('strength', describeGroup(
      compared.filter((item) => item.percent === highest), messages.strength, highest,
    ));
    if (lowest < highest) {
      add('focus', describeGroup(
        compared.filter((item) => item.percent === lowest), messages.focus, lowest,
      ));
    }
  }

  const [midterm, finals] = terms.map((term) => term.grade.value);
  if (typeof midterm === 'number' && typeof finals === 'number' && !missing.length) {
    const change = finals - midterm;
    const points = String(Math.abs(Math.round(change * 100) / 100));
    let template = messages.trend.steady;
    if (change > messages.trend.steadyWithin) template = messages.trend.up;
    if (change < -messages.trend.steadyWithin) template = messages.trend.down;
    add('trend', fill(template, { points }));
  }

  return result;
}
