import type { KnowledgeGraphEdge, KnowledgeGraphNode } from './knowledge-graph';

export interface ConstellationGroup {
  id: string;
  label: string;
  nodeIds: string[];
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
}

export interface ConstellationLayout {
  positions: Map<string, { x: number; y: number }>;
  groups: ConstellationGroup[];
  backbone: KnowledgeGraphEdge[];
}

type Candidate = { id: string; label: string; ids: Set<string>; kind: 'project' | 'tag' };
const PALETTE = ['#a8b7ed', '#c5a9df', '#91c6cb', '#e0bc90', '#a7c6a3', '#d5a6b8'];
const GOLDEN_ANGLE = 2.399963229728653;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0)!, 16777619);
  return result >>> 0;
}

function normalize(tag: string): string { return tag.normalize('NFKC').trim().toLowerCase(); }

function selectGroups(nodes: KnowledgeGraphNode[], groupTags: boolean): Candidate[] {
  const byId = new Map(nodes.map(node => [node.entry.id, node]));
  const projects: Candidate[] = [];
  for (const node of nodes) {
    if (node.entry.kind !== 'project') continue;
    const ids = new Set([node.entry.id]);
    for (const other of nodes) if (other.entry.projectId === node.entry.id) ids.add(other.entry.id);
    if (ids.size >= 2) projects.push({ id: `project:${node.entry.id}`, label: node.entry.title, ids, kind: 'project' });
  }
  projects.sort((a, b) => b.ids.size - a.ids.size || compare(a.id, b.id));

  const tags = new Map<string, { ids: Set<string>; labels: Set<string> }>();
  if (groupTags) for (const node of nodes) for (const raw of node.entry.tags) {
    const tag = normalize(raw);
    if (!tag) continue;
    const item = tags.get(tag) ?? { ids: new Set<string>(), labels: new Set<string>() };
    item.ids.add(node.entry.id);
    item.labels.add(raw.trim().normalize('NFKC'));
    tags.set(tag, item);
  }
  const tagCandidates: Candidate[] = [...tags].filter(([, value]) => value.ids.size >= 2).map(([tag, value]) => ({
    id: `tag:${tag}`,
    label: [...value.labels].sort(compare)[0] ?? tag,
    ids: value.ids,
    kind: 'tag',
  }));
  // A tag on nearly every record is a weak visual grouping. Specific repeated tags win.
  const score = (candidate: Candidate) => candidate.ids.size * (1 - candidate.ids.size / Math.max(nodes.length, 1));
  tagCandidates.sort((a, b) => score(b) - score(a) || b.ids.size - a.ids.size || compare(a.id, b.id));

  const ranked = [...projects, ...tagCandidates];
  const assigned = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of ranked) {
    const ids = new Set([...candidate.ids].filter(id => byId.has(id) && !assigned.has(id)));
    if (ids.size < 2) continue;
    // The sixth slot belongs to a named group only if it accounts for every
    // remaining star; otherwise keep room for the honest catch-all group.
    if (result.length >= 5 && ids.size < nodes.length - assigned.size) continue;
    for (const id of ids) assigned.add(id);
    result.push({ ...candidate, ids });
    if (result.length === 6) break;
  }
  const loose = nodes.map(node => node.entry.id).filter(id => !assigned.has(id));
  if (loose.length) {
    result.push({ id: 'other', label: 'その他の記憶', ids: new Set(loose), kind: 'tag' });
  }
  return result;
}

function sparseBackbone(edges: KnowledgeGraphEdge[], groupByNode: Map<string, string>, positions: Map<string, { x: number; y: number }>): KnowledgeGraphEdge[] {
  const valid = edges.filter(edge => edge.source !== edge.target && positions.has(edge.source) && positions.has(edge.target));
  const edgeOrder = (a: KnowledgeGraphEdge, b: KnowledgeGraphEdge) => {
    const pa = positions.get(a.source)!, qa = positions.get(a.target)!;
    const pb = positions.get(b.source)!, qb = positions.get(b.target)!;
    const weightA = (a.explicit ? -100000 : 0) + Math.hypot(pa.x - qa.x, pa.y - qa.y);
    const weightB = (b.explicit ? -100000 : 0) + Math.hypot(pb.x - qb.x, pb.y - qb.y);
    return weightA - weightB || compare(a.source, b.source) || compare(a.target, b.target);
  };
  const parent = new Map([...positions.keys()].map(id => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    while (id !== root) { const next = parent.get(id)!; parent.set(id, root); id = next; }
    return root;
  };
  const join = (a: string, b: string): boolean => {
    const x = find(a), y = find(b);
    if (x === y) return false;
    parent.set(y, x);
    return true;
  };
  const chosen: KnowledgeGraphEdge[] = [];
  for (const edge of valid.filter(edge => groupByNode.get(edge.source) === groupByNode.get(edge.target)).sort(edgeOrder)) {
    if (join(edge.source, edge.target)) chosen.push(edge);
  }
  const groupParent = new Map([...new Set(groupByNode.values())].map(id => [id, id]));
  const findGroup = (id: string): string => {
    while (groupParent.get(id)! !== id) id = groupParent.get(id)!;
    return id;
  };
  for (const edge of valid.filter(edge => groupByNode.get(edge.source) !== groupByNode.get(edge.target)).sort(edgeOrder)) {
    const a = findGroup(groupByNode.get(edge.source)!), b = findGroup(groupByNode.get(edge.target)!);
    if (a !== b) { groupParent.set(b, a); chosen.push(edge); }
  }
  return chosen.sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
}

/** Stable, metadata-based star fields. All returned edges are real graph relationships. */
export function buildConstellations(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  options: { width: number; height: number; groupTags: boolean },
): ConstellationLayout {
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1000;
  const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 700;
  const orderedNodes = [...nodes].sort((a, b) => compare(a.entry.id, b.entry.id));
  const candidates = selectGroups(orderedNodes, options.groupTags);
  const groupCount = candidates.length;
  const cols = Math.min(width < 750 ? 2 : 3, groupCount);
  const rows = Math.ceil(groupCount / Math.max(cols, 1));
  const marginX = Math.min(width * .1, 90);
  const marginY = Math.min(height * .16, 110);
  const cellW = (width - 2 * marginX) / Math.max(cols, 1);
  const cellH = (height - 2 * marginY) / Math.max(rows, 1);
  const positions = new Map<string, { x: number; y: number }>();
  const groupByNode = new Map<string, string>();
  const byId = new Map(orderedNodes.map(node => [node.entry.id, node]));
  const groups: ConstellationGroup[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const col = index % cols, row = Math.floor(index / cols);
    const rowItems = Math.min(cols, groupCount - row * cols);
    const rowOffset = (cols - rowItems) * cellW / 2;
    const x = marginX + cellW * (col + .5) + rowOffset
      + (rowItems > 1 ? (col % 2 ? -1 : 1) * Math.min(10, cellW * .035) : 0);
    const y = marginY + cellH * (row + .5) + ((index * 2) % 3 - 1) * Math.min(14, cellH * .045);
    const ids = [...candidate.ids].sort((a, b) => (byId.get(b)?.degree ?? 0) - (byId.get(a)?.degree ?? 0) || compare(a, b));
    const rx = Math.min(cellW * .38, 35 + Math.sqrt(ids.length) * 18);
    const ry = Math.min(cellH * .35, 42 + Math.sqrt(ids.length) * 19);
    const phase = hash(candidate.id) / 0xffffffff * Math.PI * 2;
    const points = ids.map((id, i) => {
      const radius = ids.length === 1 ? 0 : Math.sqrt((i + .25) / ids.length) * .88;
      const angle = phase + i * GOLDEN_ANGLE;
      return { id, dx: Math.cos(angle) * rx * radius, dy: Math.sin(angle) * ry * radius };
    });
    // Repel nearby stars while keeping each constellation compact and in its cell.
    const minDistance = Math.min(26, Math.max(10, Math.sqrt(cellW * cellH / Math.max(ids.length, 1)) * .35));
    for (let iteration = 0; iteration < 45; iteration++) for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      let dx = points[j].dx - points[i].dx, dy = points[j].dy - points[i].dy;
      let distance = Math.hypot(dx, dy);
      if (distance >= minDistance) continue;
      if (distance < .001) { dx = 1; dy = 0; distance = 1; }
      const push = (minDistance - distance) * .25;
      points[i].dx -= dx / distance * push; points[i].dy -= dy / distance * push;
      points[j].dx += dx / distance * push; points[j].dy += dy / distance * push;
      for (const point of [points[i], points[j]]) {
        point.dx = clamp(point.dx, -rx * .93, rx * .93);
        point.dy = clamp(point.dy, -ry * .93, ry * .93);
      }
    }
    for (const point of points) {
      positions.set(point.id, { x: clamp(x + point.dx, marginX, width - marginX), y: clamp(y + point.dy, marginY, height - marginY) });
      groupByNode.set(point.id, candidate.id);
    }
    groups.push({ id: candidate.id, label: candidate.label, nodeIds: ids.sort(compare), x, y, rx, ry, color: PALETTE[index % PALETTE.length] });
  }
  return { positions, groups, backbone: sparseBackbone([...edges], groupByNode, positions) };
}
