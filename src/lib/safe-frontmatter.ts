import matter from 'gray-matter';

const allowedLanguages = new Set(['yaml', 'yml', 'json']);

/** gray-matter enables an eval-based JavaScript engine by default. */
export function parseSafeFrontmatter(content: string): matter.GrayMatterFile<string> {
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (source.startsWith('---') && source[3] !== '-') {
    const lineEnd = source.indexOf('\n', 3);
    const language = source.slice(3, lineEnd < 0 ? source.length : lineEnd).trim().toLowerCase();
    if (language && !allowedLanguages.has(language)) throw new Error('Unsupported frontmatter language');
  }
  // Supplying options bypasses gray-matter's unbounded input cache. The engine
  // override also fails closed if its language detection changes.
  return matter(content, { engines: { javascript: { parse: () => { throw new Error('Unsupported frontmatter language'); } } } });
}
