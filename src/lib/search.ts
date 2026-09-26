import { kindLabels, type Entry } from './types';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja');
function terms(query: string) {
  return (normalize(query).match(/"[^"]+"|\S+/g) || []).map(term => term.replace(/^"|"$/g, '')).filter(Boolean);
}
function matches(entry: Entry, tokens: string[], tags: string[]) {
  if (!tokens.filter(term => term.startsWith('#')).every(term => tags.includes(term.slice(1)))) return false;
  const textTerms = tokens.filter(term => !term.startsWith('#'));
  if (!textTerms.length) return true;
  const text = normalize([entry.title, entry.body.replace(/<!--[\s\S]*?-->/g, ''), entry.source || '', kindLabels[entry.kind], ...entry.tags].join('\n'));
  return textTerms.every(term => text.includes(term));
}
export function entryMatchesQuery(entry: Entry, query: string) {
  const tokens = terms(query);
  return !tokens.length || matches(entry, tokens, entry.tags.map(normalize));
}
export function searchEntries(entries: Entry[], query: string) {
  const q = normalize(query.trim());
  const tokens = terms(query);
  // Empty lists/searches need only ordering; avoid scanning every Markdown body.
  if (!tokens.length) return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // Compute each score once, rather than normalizing titles/tags at every sort comparison.
  return entries.flatMap(entry => {
    const tags = entry.tags.map(normalize);
    if (!matches(entry, tokens, tags)) return [];
    const title = normalize(entry.title);
    const score = (title === q ? 100 : title.startsWith(q) && q ? 30 : 0)
      + tokens.reduce((sum, term) => sum + (title.includes(term) ? 10 : 0) + (tags.includes(term.replace(/^#/, '')) ? 5 : 0), 0);
    return [{ entry, score }];
  }).sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt)).map(item => item.entry);
}
