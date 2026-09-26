import type { Entry } from './types';

export interface KnowledgeGraphNode {
  entry: Entry;
  x: number;
  y: number;
  degree: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  reasons: string[];
  explicit: boolean;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  total: number;
  truncated: boolean;
}

const MAX_NODES = 120;
const DEFAULT_LIMIT = 100;
const BOUNDS = { left: 90, right: 910, top: 75, bottom: 625 };

function normalizedTag(tag: string): string {
  return tag.normalize('NFKC').trim().toLowerCase();
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  return JSON.stringify(pair(a, b));
}

function finiteLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_NODES, Math.floor(limit)));
}

function positionNodes(ids: string[], edges: KnowledgeGraphEdge[]): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const count = ids.length;
  if (!count) return result;
  if (count === 1) return result.set(ids[0], { x: 500, y: 350 });

  // A fixed initial spiral and fixed iteration count keep the result stable across renders.
  const points = ids.map((id, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt((index + 0.5) / count);
    return { id, x: Math.cos(angle) * radius * 370, y: Math.sin(angle) * radius * 240 };
  });
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const springs = edges.map((edge) => [indexById.get(edge.source)!, indexById.get(edge.target)!] as const);

  for (let iteration = 0; iteration < 110; iteration += 1) {
    const dx = new Float64Array(count);
    const dy = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let vx = points[i].x - points[j].x;
        let vy = points[i].y - points[j].y;
        const distanceSquared = Math.max(vx * vx + vy * vy, 25);
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(12, 4400 / distanceSquared);
        vx /= distance;
        vy /= distance;
        dx[i] += vx * force;
        dy[i] += vy * force;
        dx[j] -= vx * force;
        dy[j] -= vy * force;
      }
    }
    for (const [i, j] of springs) {
      const vx = points[j].x - points[i].x;
      const vy = points[j].y - points[i].y;
      const distance = Math.max(Math.hypot(vx, vy), 1);
      const force = Math.max(-3, Math.min(3, (distance - 105) * 0.018));
      dx[i] += vx / distance * force;
      dy[i] += vy / distance * force;
      dx[j] -= vx / distance * force;
      dy[j] -= vy / distance * force;
    }
    for (let i = 0; i < count; i += 1) {
      points[i].x += Math.max(-9, Math.min(9, dx[i] - points[i].x * 0.003));
      points[i].y += Math.max(-9, Math.min(9, dy[i] - points[i].y * 0.003));
    }
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const width = Math.min(BOUNDS.right - BOUNDS.left, 165 * Math.sqrt(count));
  const height = Math.min(BOUNDS.bottom - BOUNDS.top, 115 * Math.sqrt(count));
  const scale = Math.min(width / spanX, height / spanY);
  for (const point of points) {
    result.set(point.id, {
      x: 500 + (point.x - (minX + maxX) / 2) * scale,
      y: 350 + (point.y - (minY + maxY) / 2) * scale,
    });
  }
  return result;
}

export function buildKnowledgeGraph(
  entries: Entry[],
  options: { includeArchived?: boolean; sharedTags?: boolean; limit?: number; focusId?: string } = {},
): KnowledgeGraph {
  const eligible = new Map<string, Entry>();
  for (const entry of entries) {
    if (entry.deletedAt || (!options.includeArchived && entry.status === 'archived')) continue;
    const previous = eligible.get(entry.id);
    if (!previous || entry.updatedAt > previous.updatedAt) eligible.set(entry.id, entry);
  }
  const candidates = [...eligible.values()];
  const tagOwners = new Map<string, Set<string>>();
  if (options.sharedTags !== false) {
    for (const entry of candidates) {
      for (const tag of new Set(entry.tags.map(normalizedTag).filter(Boolean))) {
        if (!tagOwners.has(tag)) tagOwners.set(tag, new Set());
        tagOwners.get(tag)!.add(entry.id);
      }
    }
  }
  const priority = new Map(candidates.map((entry) => [entry.id, 0]));
  const focus = options.focusId ? eligible.get(options.focusId) : undefined;
  const focusNeighbors = new Set<string>();
  if (focus) {
    for (const id of focus.relatedIds ?? []) focusNeighbors.add(id);
    if (focus.projectId && eligible.get(focus.projectId)?.kind === 'project') focusNeighbors.add(focus.projectId);
    if (options.sharedTags !== false) {
      for (const tag of new Set(focus.tags.map(normalizedTag).filter(Boolean))) {
        for (const id of tagOwners.get(tag) ?? []) focusNeighbors.add(id);
      }
    }
  }
  for (const entry of candidates) {
    if (focus && entry.id !== focus.id) {
      if (entry.relatedIds?.includes(focus.id)) focusNeighbors.add(entry.id);
      if (focus.kind === 'project' && entry.projectId === focus.id) focusNeighbors.add(entry.id);
    }
    for (const id of new Set(entry.relatedIds ?? [])) {
      if (id !== entry.id && eligible.has(id)) priority.set(entry.id, priority.get(entry.id)! + 3);
    }
    if (entry.projectId && entry.projectId !== entry.id && eligible.get(entry.projectId)?.kind === 'project') {
      priority.set(entry.id, priority.get(entry.id)! + 2);
      priority.set(entry.projectId, priority.get(entry.projectId)! + 2);
    }
    for (const tag of new Set(entry.tags.map(normalizedTag).filter(Boolean))) {
      if ((tagOwners.get(tag)?.size ?? 0) > 1) priority.set(entry.id, priority.get(entry.id)! + 1);
    }
  }
  candidates.sort((a, b) =>
    Number(b.id === focus?.id) - Number(a.id === focus?.id) ||
    Number(focusNeighbors.has(b.id)) - Number(focusNeighbors.has(a.id)) ||
    (priority.get(b.id)! - priority.get(a.id)!) ||
    b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const selected = candidates.slice(0, finiteLimit(options.limit)).sort((a, b) => a.id.localeCompare(b.id));
  const selectedById = new Map(selected.map((entry) => [entry.id, entry]));
  const edgeMap = new Map<string, KnowledgeGraphEdge>();
  function addEdge(a: string, b: string, reason: string, explicit: boolean): void {
    if (a === b || !selectedById.has(a) || !selectedById.has(b)) return;
    const [source, target] = pair(a, b);
    const key = pairKey(a, b);
    let edge = edgeMap.get(key);
    if (!edge) {
      edge = { source, target, reasons: [], explicit: false };
      edgeMap.set(key, edge);
    }
    if (!edge.reasons.includes(reason)) edge.reasons.push(reason);
    edge.explicit ||= explicit;
  }
  for (const entry of selected) {
    for (const id of entry.relatedIds ?? []) addEdge(entry.id, id, '関連する記録', true);
    if (entry.projectId && selectedById.get(entry.projectId)?.kind === 'project') {
      addEdge(entry.id, entry.projectId, '所属プロジェクト', true);
    }
  }
  if (options.sharedTags !== false) {
    const owners = new Map<string, string[]>();
    for (const entry of selected) {
      for (const tag of new Set(entry.tags.map(normalizedTag).filter(Boolean))) {
        if (!owners.has(tag)) owners.set(tag, []);
        owners.get(tag)!.push(entry.id);
      }
    }
    for (const [tag, ids] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          addEdge(ids[i], ids[j], `共通タグ: ${tag}`, false);
        }
      }
    }
  }
  const edges = [...edgeMap.values()].sort((a, b) =>
    a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const degrees = new Map(selected.map((entry) => [entry.id, 0]));
  for (const edge of edges) {
    degrees.set(edge.source, degrees.get(edge.source)! + 1);
    degrees.set(edge.target, degrees.get(edge.target)! + 1);
  }
  const positions = positionNodes(selected.map((entry) => entry.id), edges);
  return {
    nodes: selected.map((entry) => ({ entry, ...positions.get(entry.id)!, degree: degrees.get(entry.id)! })),
    edges,
    total: candidates.length,
    truncated: selected.length < candidates.length,
  };
}
