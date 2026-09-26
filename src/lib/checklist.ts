export type ChecklistLine = { checked: boolean; explicit: boolean };

// The offset must come from a parsed Markdown list item. Matching only at that
// exact position prevents equal labels elsewhere (or text in code blocks) from
// changing when a checkbox is pressed.
function markerAt(body: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= body.length) return null;
  const lineEnd = body.indexOf('\n', offset);
  const line = body.slice(offset, lineEnd === -1 ? undefined : lineEnd);
  const marker = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(line);
  if (!marker) return null;
  const task = /^\[([ xX])\][ \t]+/.exec(line.slice(marker[0].length));
  return { marker: marker[0], task, offset };
}

export function inspectChecklistLine(body: string, offset: number): ChecklistLine | null {
  const found = markerAt(body, offset);
  return found ? { checked: found.task?.[1].toLowerCase() === 'x', explicit: Boolean(found.task) } : null;
}

export function toggleChecklistLine(body: string, offset: number): string {
  const found = markerAt(body, offset);
  if (!found) return body;
  const taskOffset = offset + found.marker.length;
  if (found.task) {
    const markOffset = taskOffset + 1;
    const checked = found.task[1].toLowerCase() === 'x';
    return body.slice(0, markOffset) + (checked ? ' ' : 'x') + body.slice(markOffset + 1);
  }
  return body.slice(0, taskOffset) + '[x] ' + body.slice(taskOffset);
}
