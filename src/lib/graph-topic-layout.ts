/** Topic coordinates are world coordinates; label dimensions and clearance are screen pixels. */
export interface GraphTopic {
  id?: string;
  tag: string;
  x: number;
  y: number;
  count: number;
}

export interface PlacedGraphTopic extends GraphTopic {
  labelX: number;
  labelY: number;
  width: number;
  height: number;
}

type Point = { x: number; y: number };
type Bounds = { width: number; height: number };
type ReservedArea = { x: number; y: number; width: number; height: number };

const LABEL_HEIGHT = 32;
const NODE_CLEARANCE = 8;
const LABEL_GAP = 8;
const EDGE_GAP = 4;
const RADII = [0, 32, 42, 60, 80, 102, 126, 154, 184, 218, 254];
const ANGLES = Array.from({ length: 16 }, (_, index) => -Math.PI / 2 + index * Math.PI / 8);

/** Width of the visible, at most twelve-character tag and its count. */
export function graphTopicLabelWidth(tag: string, count: number): number {
  const visible = [...tag].slice(0, 12);
  const units = visible.reduce((total, char) => total + (/^[\u0020-\u007e]$/.test(char) ? 0.58 : 1), 0);
  const digits = String(count).length;
  return Math.max(110, Math.min(170, Math.ceil(38 + units * 10 + digits * 6)));
}

/** Place up to six topic pills without hiding star centers or another pill.
 * A topic's x/y remain its original centroid, so choosing it still zooms there.
 * A topic with no safe on-screen candidate is omitted.
 */
export function placeGraphTopics(
  topics: readonly GraphTopic[],
  nodes: readonly Point[],
  scale: number,
  bounds?: Bounds,
  reservedAreas: readonly ReservedArea[] = [],
): PlacedGraphTopic[] {
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const validBounds = bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
    && bounds.width > 0 && bounds.height > 0 ? bounds : undefined;
  const validNodes = nodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
  const validAreas = reservedAreas.filter(area => [area.x, area.y, area.width, area.height].every(Number.isFinite)
    && area.width > 0 && area.height > 0);
  const labels: PlacedGraphTopic[] = [];
  const ordered = topics.map((topic, index) => ({ topic, index }))
    .filter(({ topic }) => Number.isFinite(topic.x) && Number.isFinite(topic.y) && Number.isFinite(topic.count))
    .sort((a, b) => b.topic.count - a.topic.count || a.topic.tag.localeCompare(b.topic.tag) || a.index - b.index)
    .slice(0, 6);

  for (const { topic } of ordered) {
    const width = graphTopicLabelWidth(topic.tag, topic.count);
    const height = LABEL_HEIGHT;
    for (const radius of RADII) {
      let placed = false;
      for (const angle of ANGLES) {
        const labelX = topic.x + Math.cos(angle) * radius / scale;
        const labelY = topic.y + Math.sin(angle) * radius / scale;
        const halfWidth = width / (2 * scale);
        const halfHeight = height / (2 * scale);
        if (validBounds && (labelX - halfWidth < EDGE_GAP / scale
          || labelX + halfWidth > validBounds.width - EDGE_GAP / scale
          || labelY - halfHeight < EDGE_GAP / scale
          || labelY + halfHeight > validBounds.height - EDGE_GAP / scale)) continue;
        if (validAreas.some(area => labelX + halfWidth + EDGE_GAP / scale > area.x
          && labelX - halfWidth - EDGE_GAP / scale < area.x + area.width
          && labelY + halfHeight + EDGE_GAP / scale > area.y
          && labelY - halfHeight - EDGE_GAP / scale < area.y + area.height)) continue;
        if (validNodes.some(node => Math.abs(node.x - labelX) < halfWidth + NODE_CLEARANCE / scale
          && Math.abs(node.y - labelY) < halfHeight + NODE_CLEARANCE / scale)) continue;
        if (labels.some(label => Math.abs(label.labelX - labelX) < (label.width + width + LABEL_GAP * 2) / (2 * scale)
          && Math.abs(label.labelY - labelY) < (label.height + height + LABEL_GAP * 2) / (2 * scale))) continue;
        labels.push({ ...topic, labelX, labelY, width, height });
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  return labels;
}
