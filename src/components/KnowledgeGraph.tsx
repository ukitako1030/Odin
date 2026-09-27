'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowUpRight, Focus, Minus, Plus, Search, Sparkles, X } from 'lucide-react';
import type { Entry, EntryKind } from '@/lib/types';
import { useI18n } from '@/components/I18nProvider';
import { buildKnowledgeGraph } from '@/lib/knowledge-graph';
import styles from './KnowledgeGraph.module.css';
import { useGraphCamera } from './useGraphCamera';
import GraphSky from './GraphSky';
import { placeGraphTopics } from '@/lib/graph-topic-layout';
import { buildConstellations } from '@/lib/graph-constellations';

const colors: Record<EntryKind, string> = { knowledge: '#afbcff', idea: '#d4abeb', project: '#e5c894', memo: '#8bcbd2', task: '#93b7e0', shopping: '#a4cca5', reminder: '#e3a9b3' };
const kinds = Object.keys(colors) as EntryKind[];
const preview = (body: string) => body.replace(/<!--[\s\S]*?-->/g, '').replace(/[#*`>\[\]()_~]/g, '').replace(/\s+/g, ' ').trim();

export default function KnowledgeGraph({ entries, loading, focusId, onFocus, onOpen, motion = true }: {
  entries: Entry[]; loading: boolean; motion?: boolean; focusId: string | null; onFocus: (id: string | null) => void; onOpen: (entry: Entry) => void;
}) {
  const { t, kindLabels } = useI18n();
  const glowId = useId().replace(/:/g, '');
  const [query, setQuery] = useState('');
  const [sharedTags, setSharedTags] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [local, setLocal] = useState(false);
  const [mobile, setMobile] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const { camera, reset, zoomBy, focusAt, suppressClick, bind } = useGraphCamera(svg);
  const [viewport, setViewport] = useState({ width: 600, height: 700 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const pendingLocation = useRef<string | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => setMobile(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const eligible = useMemo(() => entries.filter(entry => !entry.deletedAt && (includeArchived || entry.status !== 'archived')), [entries, includeArchived]);
  const graph = useMemo(() => buildKnowledgeGraph(eligible, { sharedTags, includeArchived, focusId: focusId || undefined }), [eligible, sharedTags, includeArchived, focusId]);
  const selected = eligible.find(entry => entry.id === focusId);
  const adjacent = useMemo(() => graph.edges.filter(edge => edge.source === focusId || edge.target === focusId), [graph.edges, focusId]);
  const neighborhood = useMemo(() => new Set([focusId, ...adjacent.map(edge => edge.source === focusId ? edge.target : edge.source)]), [focusId, adjacent]);
  const isLocal = local && Boolean(selected);
  const localGraph = useMemo(() => isLocal ? buildKnowledgeGraph(eligible.filter(entry => neighborhood.has(entry.id)), { sharedTags, includeArchived, focusId: focusId || undefined }) : graph, [isLocal, eligible, neighborhood, sharedTags, includeArchived, focusId, graph]);
  const nodes = localGraph.nodes;
  const nodeMap = useMemo(() => new Map(nodes.map(node => [node.entry.id, node])), [nodes]);
  const matching = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? eligible.filter(entry => terms.every(term => `${entry.title} ${entry.tags.join(' ')}`.toLocaleLowerCase().includes(term))) : [];
  }, [eligible, query]);
  const matches = new Set(matching.map(entry => entry.id));
  const worldWidth = mobile ? 600 : 1000;
  const worldHeight = 700;
  const fitScale = Math.max(.1, Math.min(viewport.width / worldWidth, viewport.height / worldHeight));
  const screenScale = fitScale * camera.zoom;
  const detailLevel = camera.zoom >= 3 ? 'detail' : camera.zoom >= 1.65 ? 'names' : 'overview';
  const constellations = useMemo(() => buildConstellations(nodes, localGraph.edges, { width: worldWidth, height: worldHeight, groupTags: sharedTags }), [nodes, localGraph.edges, worldWidth, sharedTags]);
  const positions = constellations.positions;
  const membership = useMemo(() => new Map(constellations.groups.flatMap(group => group.nodeIds.map(id => [id, group] as const))), [constellations]);
  const anchors = useMemo(() => new Set(constellations.groups.map(group => [...group.nodeIds].sort((a, b) => (nodeMap.get(b)?.degree ?? 0) - (nodeMap.get(a)?.degree ?? 0) || a.localeCompare(b))[0])), [constellations, nodeMap]);
  const visibleEdges = useMemo(() => {
    const all = new Map(constellations.backbone.map(edge => [`${edge.source}:${edge.target}`, edge]));
    if (selected) for (const edge of localGraph.edges) if (edge.source === focusId || edge.target === focusId) all.set(`${edge.source}:${edge.target}`, edge);
    return [...all.values()];
  }, [constellations, localGraph.edges, selected, focusId]);
  const hitRadii = useMemo(() => new Map(nodes.map(node => {
    const point = positions.get(node.entry.id)!;
    let nearest = Infinity;
    for (const other of nodes) {
      if (other.entry.id === node.entry.id) continue;
      const candidate = positions.get(other.entry.id)!;
      nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y));
    }
    // Enlarged invisible targets must never cover a neighboring star's center.
    return [node.entry.id, Math.min((mobile ? 18 : 11) / screenScale, nearest * .48)];
  })), [nodes, positions, mobile, screenScale]);
  useEffect(() => {
    const point = pendingLocation.current ? positions.get(pendingLocation.current) : undefined;
    if (point) { pendingLocation.current = null; focusAt(point.x, point.y, 2.4); }
  }, [positions, focusAt]);
  const position = (node: { entry: Entry }) => positions.get(node.entry.id)!;
  const labelText = (entry: Entry) => {
    const length = detailLevel === 'detail' ? 26 : 16;
    return entry.title.length > length ? `${entry.title.slice(0, length)}…` : entry.title;
  };
  const labelAnchor = (x: number) => x * camera.zoom + camera.x < 80 / fitScale ? 'start' : x * camera.zoom + camera.x > worldWidth - 80 / fitScale ? 'end' : 'middle';
  const topics = useMemo(() => {
    const placed = constellations.groups.filter(group => group.nodeIds.length >= 2).map(group => ({ id: group.id, tag: group.id === 'other' ? t('その他の記憶') : group.label, x: group.x, y: group.y + group.ry + 20 / screenScale, count: group.nodeIds.length }));
    // Lay captions out in the visible viewport, including SVG letterboxing and
    // the current camera, so they also avoid the caption and zoom controls.
    const offsetX = (viewport.width - worldWidth * fitScale) / 2;
    const offsetY = (viewport.height - worldHeight * fitScale) / 2;
    const toScreen = (point: { x: number; y: number }) => ({
      x: offsetX + (point.x * camera.zoom + camera.x) * fitScale,
      y: offsetY + (point.y * camera.zoom + camera.y) * fitScale,
    });
    const layout = placeGraphTopics(placed.map(topic => ({ ...topic, ...toScreen(topic) })),
      [...positions.values()].map(toScreen), 1, viewport,
      [{ x: 0, y: 0, width: viewport.width, height: 64 },
        { x: 0, y: viewport.height - 64, width: viewport.width, height: 64 }]);
    return layout.map(topic => ({ ...topic,
      x: constellations.groups.find(group => group.id === topic.id)?.x ?? (topic.x - offsetX) / screenScale - camera.x / camera.zoom,
      y: constellations.groups.find(group => group.id === topic.id)?.y ?? (topic.y - offsetY) / screenScale - camera.y / camera.zoom,
      labelX: (topic.labelX - offsetX) / screenScale - camera.x / camera.zoom,
      labelY: (topic.labelY - offsetY) / screenScale - camera.y / camera.zoom,
    }));
  }, [constellations, positions, screenScale, worldWidth, viewport, fitScale, camera, t]);
  const connectionReason = (reason: string) => reason.startsWith('共通タグ: ') ? t('共通タグ: {tag}', { tag: reason.slice('共通タグ: '.length) }) : t(reason);
  // Keep the selected title first, then admit labels only where they have room.
  const labelIds = new Set<string>();
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  for (const node of [...nodes].sort((a, b) => Number(b.entry.id === focusId) - Number(a.entry.id === focusId) || b.degree - a.degree)) {
    if (detailLevel === 'overview' && node.entry.id !== focusId && !matches.has(node.entry.id)) continue;
    if (selected && !neighborhood.has(node.entry.id) && !matches.has(node.entry.id)) continue;
    const point = position(node), font = (mobile ? 10 : 11) / screenScale;
    const width = [...labelText(node.entry)].reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? .6 : 1), 0) * font + 12;
    const anchor = labelAnchor(point.x);
    const box = { x: point.x - (anchor === 'start' ? 0 : anchor === 'end' ? width : width / 2), y: point.y + 10 / screenScale, width, height: font + 6 / screenScale };
    if (!occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)) { labelIds.add(node.entry.id); occupied.push(box); }
  }

  function choose(id: string, locate = false) {
    if (locate) {
      const point = positions.get(id);
      if (point) focusAt(point.x, point.y, 2.4);
      else pendingLocation.current = id;
    }
    onFocus(id); setQuery('');
  }

  return <section className={styles.page} aria-label={t('知識の星図')}>
    <header className={styles.heading}>
      <div><span className={styles.overline}>MUNIN / CONSTELLATIONS</span><h1>{t('知識の星図')}</h1><p>{t('ひとつの記憶から、思いがけないつながりへ。')}</p></div>
      <div className={styles.totals}><strong>{graph.total}<small>{t('記録')}</small></strong><span>／</span><strong>{graph.edges.length}<small>{t('つながり')}</small></strong></div>
    </header>
    <div className={`${styles.workspace} ${!selected ? styles.overview : ''}`}>
      <div className={styles.mapPanel}>
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <label className={styles.search}><Search size={16}/><input aria-label={t('星図の記録を検索')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('記録やタグから探す')}/>{query && <button aria-label={t('検索をクリア')} onClick={() => setQuery('')}><X size={16}/></button>}</label>
            {query.trim() && <div className={styles.results} aria-label={t('星図の検索結果')}><small>{t('{count}件の記録', { count: matching.length })}</small>{matching.slice(0, 20).map(entry => <button key={entry.id} aria-label={t('{title}のつながりを見る', { title: entry.title })} onClick={() => choose(entry.id, true)}><i style={{ background: colors[entry.kind] }}/><span>{entry.title}</span><ArrowUpRight size={14}/></button>)}{matching.length === 0 && <p>{t('見つかりませんでした。別の言葉で探してみてください。')}</p>}{matching.length > 20 && <p>{t('先頭20件を表示しています。言葉を追加して絞り込めます。')}</p>}</div>}
          </div>
          <div className={styles.mode} aria-label={t('星図の表示範囲')}><button aria-pressed={!isLocal} onClick={() => { setLocal(false); reset(); }}>{t('全体')}</button><button aria-pressed={isLocal} disabled={!selected} onClick={() => { setLocal(true); reset(); }}>{t('周辺だけ')}</button></div>
        </div>
        <div className={styles.canvas} ref={canvasRef}><GraphSky enabled={motion}/>
          <div className={styles.mapCaption}><span>{detailLevel === 'overview' ? t('{count}の星座に広がる記憶', { count: constellations.groups.length }) : detailLevel === 'names' ? t('記録の名前') : t('記録を詳しく見る')}</span><small>{mobile ? t('2本指で拡大・縮小') : t('ホイールで拡大・縮小')} · {Math.round(camera.zoom * 100)}%</small></div>
          {mobile && selected && <div className={styles.mobileSelection}><span>{selected.title}<small>{t('{count}件のつながり', { count: adjacent.length })}</small></span><button onClick={() => inspectorRef.current?.scrollIntoView({ block: 'start' })}>{t('関連を見る')}</button><button aria-label={t('選択した記録を開く')} onClick={() => onOpen(selected)}><ArrowUpRight size={17}/></button></div>}
          {loading ? <div className={styles.empty} role="status"><Sparkles/><h2>{t('記憶をつないでいます')}</h2></div> : nodes.length === 0 ? <div className={styles.empty}><Sparkles/><h2>{t('最初の記憶が、星になる。')}</h2><p>{t('記録を残すと、ここに星が増えていきます。')}<br/>{t('タグや関連する記録で、つながりを育てましょう。')}</p></div> : <svg ref={svg} className={styles.svg} viewBox={`0 0 ${worldWidth} ${worldHeight}`} role="group" aria-label={t('記録のつながり')} data-zoom={camera.zoom} data-detail-level={detailLevel} {...bind}>
            <defs>{kinds.map(kind => <radialGradient key={kind} id={`${glowId}-${kind}`}><stop offset="0" stopColor={colors[kind]} stopOpacity=".8"/><stop offset=".32" stopColor={colors[kind]} stopOpacity=".32"/><stop offset="1" stopColor={colors[kind]} stopOpacity="0"/></radialGradient>)}{constellations.groups.map((group, index) => <radialGradient key={group.id} id={`${glowId}-realm-${index}`}><stop stopColor={group.color} stopOpacity=".22"/><stop offset=".45" stopColor={group.color} stopOpacity=".09"/><stop offset="1" stopColor={group.color} stopOpacity="0"/></radialGradient>)}</defs>
            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
              <g aria-hidden="true" className={styles.realms}>{constellations.groups.map((group, index) => <g key={group.id} data-constellation="true" data-group-id={group.id} className={`${styles.realm} ${selected && !group.nodeIds.includes(selected.id) ? styles.realmQuiet : ''}`} style={{ '--phase': `${index * -4}s`, '--realm-color': group.color } as CSSProperties}>
                <ellipse cx={group.x} cy={group.y} rx={group.rx * 1.6 + 20} ry={group.ry * 1.7 + 20} fill={`url(#${glowId}-realm-${index})`} className={styles.realmGlow}/>
                {group.nodeIds.length >= 3 && <path className={styles.realmArc} d={`M${group.x - group.rx * 1.15} ${group.y - group.ry * .35} A${group.rx * 1.23} ${group.ry * 1.25} -18 0 1 ${group.x + group.rx * .6} ${group.y - group.ry * 1.1}`}/>}
              </g>)}</g>
              <g aria-hidden="true" className={styles.routes}>{visibleEdges.map((edge, index) => {
                const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target);
                if (!source || !target) return null;
                const a = position(source), b = position(target);
                const lit = focusId === edge.source || focusId === edge.target;
                const cross = membership.get(edge.source)?.id !== membership.get(edge.target)?.id;
                const d = cross ? `M${a.x} ${a.y} Q${(a.x + b.x) / 2 + (b.y - a.y) * .13} ${(a.y + b.y) / 2 - (b.x - a.x) * .13} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`;
                return <g key={`${edge.source}:${edge.target}`} style={{ '--route-color': membership.get(edge.source)?.color ?? '#b9c6ea', '--phase': `${index * -1.37}s`, '--period': `${9 + index % 6}s` } as CSSProperties}>
                  <path data-constellation-edge="true" data-source={edge.source} data-target={edge.target} d={d} className={`${styles.edge} ${cross ? styles.bridge : styles.backbone} ${lit ? styles.edgeLit : ''} ${selected && !lit ? styles.edgeQuiet : ''}`} strokeDasharray={edge.explicit ? undefined : '2 5'}/>
                  {index % 3 === 0 && index < 90 && (!selected || lit) && <path data-signal="true" d={d} pathLength={100} className={styles.signal}/>}
                </g>;
              })}</g>
              {nodes.map((node, index) => {
                const point = position(node), active = node.entry.id === focusId;
                const dim = (selected && !neighborhood.has(node.entry.id)) || (query.trim() && !matches.has(node.entry.id));
                const labelled = labelIds.has(node.entry.id);
                const major = anchors.has(node.entry.id) && node.degree > 0;
                const size = (active ? 4.5 : major ? 3.8 : 1.9 + Math.min(.8, Math.sqrt(node.degree) * .12)) / screenScale;
                return <g key={node.entry.id} data-node-id={node.entry.id} data-group-id={membership.get(node.entry.id)?.id} role="button" tabIndex={0} aria-label={t('{title}のつながりを見る', { title: node.entry.title })} aria-pressed={active} transform={`translate(${point.x} ${point.y})`} className={`${styles.node} ${major ? styles.major : ''} ${active ? styles.selected : ''} ${dim ? styles.dim : ''}`} style={{ '--star': colors[node.entry.kind], '--phase': `${index * -.73}s`, '--period': `${7 + index % 7}s` } as CSSProperties} onClick={() => { if (!suppressClick()) choose(node.entry.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.entry.id); } }}>
                  <title>{node.entry.title} · {kindLabels[node.entry.kind]} · {t('{count}件のつながり', { count: node.degree })}</title>
                  <circle r={hitRadii.get(node.entry.id)} fill="transparent"/>
                  <circle className={styles.corona} r={size + (major ? 24 : 10) / screenScale} style={{ fill: `url(#${glowId}-${node.entry.kind})` }}/><circle className={styles.halo} r={size + (major ? 13 : 5) / screenScale} style={{ fill: `url(#${glowId}-${node.entry.kind})` }}/>
                  {major && <><circle r={11 / screenScale} className={styles.principalRing}/><path className={styles.principalRay} d={`M${-20 / screenScale} 0H${20 / screenScale}M0 ${-25 / screenScale}V${25 / screenScale}`} style={{ strokeWidth: .65 / screenScale }}/></>}
                  {active && <circle r={size + 5 / screenScale} className={styles.orbit}/>}
                  <circle data-star="true" r={size} className={styles.star}/><circle r={size * .38} className={styles.starCore}/>{(active || node.degree >= 5) && <path className={styles.flare} d={`M${-size - 3 / screenScale} 0H${size + 3 / screenScale}M0 ${-size - 5 / screenScale}V${size + 5 / screenScale}`} style={{ strokeWidth: .6 / screenScale }}/> }
                  <text data-graph-label="true" y={size + 12 / screenScale} textAnchor={labelAnchor(point.x)} className={`${styles.label} ${labelled ? styles.labelVisible : ''}`} style={{ strokeWidth: 3 / screenScale }} fontSize={(mobile ? 10 : 11) / screenScale}>{labelText(node.entry)}</text>
                </g>;
              })}
              {detailLevel === 'overview' && !selected && topics.map(topic => <g key={topic.id} className={`${styles.topic} ${styles.constellationTitle}`} role="button" tabIndex={0} aria-label={t('{tag}の集まりを拡大', { tag: topic.tag })} transform={`translate(${topic.labelX} ${topic.labelY}) scale(${1 / screenScale})`} onClick={() => { if (!suppressClick()) focusAt(topic.x, topic.y, 2.4); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusAt(topic.x, topic.y, 2.4); } }}>
                <rect x={-topic.width / 2} y={-topic.height / 2} width={topic.width} height={topic.height} rx={2}/><path d={`M${-topic.width / 2 + 10} 15H${topic.width / 2 - 10}`}/><text textAnchor="middle" y={-2}>{topic.tag.length > 12 ? `${topic.tag.slice(0,12)}…` : topic.tag}</text><text className={styles.constellationMeta} textAnchor="middle" y={11}>{topic.count} RECORDS</text>
              </g>)}
            </g>
          </svg>}
          <div className={styles.zoom} aria-label={t('星図の拡大操作')}><button aria-label={t('星図を縮小')} onClick={() => zoomBy(.8)} disabled={camera.zoom <= 0.65}><Minus size={17}/></button><button aria-label={t('星図を全体に合わせる')} onClick={() => reset()}><Focus size={17}/></button><button aria-label={t('星図を拡大')} onClick={() => zoomBy(1.25)} disabled={camera.zoom >= 6}><Plus size={17}/></button></div>
          <span className={styles.hint}>{detailLevel === 'overview' ? t('拡大すると、記録名が見えます') : t('点をタップ → 関連を見る')}</span>
        </div>
        <div className={styles.legend}>{kinds.filter(kind => eligible.some(entry => entry.kind === kind)).map(kind => <span key={kind}><i style={{ background: colors[kind] }}/>{kindLabels[kind]}</span>)}</div>
        <div className={styles.options}><label><input type="checkbox" checked={sharedTags} onChange={event => setSharedTags(event.target.checked)}/>{t('共通タグ')}</label><label><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)}/>{t('アーカイブを含める')}</label><span>{t('実線：関連・所属　点線：共通タグ')}<br/>{t('全体では線を整理。星を選ぶと、そのつながりをすべて表示。')}</span></div>
        {graph.truncated && <p className={styles.limit}>{t('全{total}件のうち{shown}件を表示しています。検索すると、ほかの記録も選べます。', { total: graph.total, shown: graph.nodes.length })}</p>}
      </div>
      <aside ref={inspectorRef} className={styles.inspector} aria-label={t('選択した記録')} aria-live="polite">
        {selected ? <>
          <div className={styles.inspectorTop}><span><i style={{ background: colors[selected.kind] }}/>{kindLabels[selected.kind]}{selected.status === 'archived' ? ` · ${t('アーカイブ')}` : ''}</span><button aria-label={t('星図の選択を解除')} onClick={() => { onFocus(null); setLocal(false); reset(); }}><X size={17}/></button></div>
          <h2>{selected.title}</h2><p className={styles.excerpt}>{preview(selected.body).slice(0, 180) || t('本文はまだありません。')}</p>
          {selected.tags.length > 0 && <div className={styles.tags}>{selected.tags.map(tag => <span key={tag}># {tag}</span>)}</div>}
          <button className={styles.open} onClick={() => onOpen(selected)}>{t('記録を開く')}<ArrowUpRight size={17}/></button>
          <div className={styles.connectionsTitle}><h3>{t('つながっている記録')}</h3><span>{adjacent.length}</span></div>
          <div className={styles.connections}>{adjacent.map(edge => {
            const id = edge.source === selected.id ? edge.target : edge.source;
            const entry = eligible.find(item => item.id === id);
            return entry ? <button key={id} onClick={() => choose(id, true)} aria-label={t('{title}のつながりを見る', { title: entry.title })}><i style={{ background: colors[entry.kind] }}/><span><strong>{entry.title}</strong><small>{edge.reasons.map(connectionReason).join(' / ')}</small></span><ArrowUpRight size={14}/></button> : null;
          })}</div>
          {adjacent.length === 0 && <p className={styles.note}>{t('まだつながりがありません。記録の編集でタグや関連する記録を追加できます。')}</p>}
        </> : <div className={styles.welcome}><svg className={styles.seal} viewBox="0 0 160 130" aria-hidden="true"><circle cx="80" cy="65" r="52"/><path d="M30 80L66 27L102 70L136 44M30 80L90 110L102 70L66 27"/>{[[30,80],[66,27],[102,70],[136,44],[90,110]].map(([x,y])=><g key={x}><circle cx={x} cy={y} r="6"/><circle cx={x} cy={y} r="2"/></g>)}</svg><span className={styles.overline}>FOLLOW A THOUGHT</span><h2>{t('つながりから探す。')}</h2><p>{t('まず拡大して、記録名を表示。')}<br/>{t('点を選ぶと、その記録につながる線と')}<br/>{t('関連する記録が見えます。')}</p><div className={styles.exampleLine}><i/><span/><i/></div><small>{t('記録は点に。つながりは線に。')}<br/>{t('共通のタグも、発見の手がかりになります。')}</small>{focusId && <p className={styles.note}>{t('選択した記録は現在の表示対象にありません。')}</p>}</div>}
      </aside>
    </div>
  </section>;
}
