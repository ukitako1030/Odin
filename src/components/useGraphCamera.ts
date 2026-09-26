import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export type GraphCameraState = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type TrackedPointer = Point & { startX: number; startY: number };

const INITIAL_CAMERA: GraphCameraState = { x: 0, y: 0, zoom: 1 };
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 6;

/** Keep the world point beneath `anchor` fixed while zooming. */
export function zoomGraphCamera(camera: GraphCameraState, factor: number, anchor: Point): GraphCameraState {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    zoom,
  };
}

function viewPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  const box = svg.getBoundingClientRect();
  const view = svg.viewBox.baseVal;
  return {
    x: view.x + (clientX - box.left) / Math.max(box.width, 1) * view.width,
    y: view.y + (clientY - box.top) / Math.max(box.height, 1) * view.height,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function separation(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function useGraphCamera(svgRef: RefObject<SVGSVGElement | null>) {
  const [camera, setCamera] = useState<GraphCameraState>(INITIAL_CAMERA);
  const current = useRef<GraphCameraState>(INITIAL_CAMERA);
  const pointers = useRef(new Map<number, TrackedPointer>());
  const transferred = useRef(new Set<number>());
  const clickSuppressed = useRef(false);

  const commit = useCallback((next: GraphCameraState) => {
    current.current = next;
    setCamera(next);
  }, []);

  const reset = useCallback(() => commit(INITIAL_CAMERA), [commit]);
  const zoomBy = useCallback((factor: number) => {
    const view = svgRef.current?.viewBox.baseVal;
    const anchor = view ? { x: view.x + view.width / 2, y: view.y + view.height / 2 } : { x: 500, y: 350 };
    commit(zoomGraphCamera(current.current, factor, anchor));
  }, [commit, svgRef]);
  const focusAt = useCallback((x: number, y: number, zoom: number) => {
    if (![x, y, zoom].every(Number.isFinite)) return;
    const view = svgRef.current?.viewBox.baseVal;
    const center = view ? { x: view.x + view.width / 2, y: view.y + view.height / 2 } : { x: 500, y: 350 };
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    commit({ x: center.x - x * nextZoom, y: center.y - y * nextZoom, zoom: nextZoom });
  }, [commit, svgRef]);
  const suppressClick = useCallback(() => clickSuppressed.current, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointers.current.size >= 2) return;
    const svg = event.currentTarget;
    const point = viewPoint(svg, event.clientX, event.clientY);
    if (pointers.current.size === 0) clickSuppressed.current = false;
    pointers.current.set(event.pointerId, { ...point, startX: event.clientX, startY: event.clientY });
    if (pointers.current.size > 1) {
      clickSuppressed.current = true;
      // Semantic labels may disappear mid-pinch; keep both pointers on the stable SVG.
      for (const id of pointers.current.keys()) {
        transferred.current.add(id);
        svg.setPointerCapture(id);
      }
    }
    // Capture on the original node so an un-dragged click still reaches its button.
    else (event.target as Element).setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const pointer = pointers.current.get(event.pointerId);
    if (!pointer) return;
    const point = viewPoint(event.currentTarget, event.clientX, event.clientY);
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { ...pointer, ...point });
    const after = [...pointers.current.values()];
    if (after.length >= 2) {
      const oldCenter = midpoint(before[0], before[1]);
      const newCenter = midpoint(after[0], after[1]);
      const oldDistance = separation(before[0], before[1]);
      const newDistance = separation(after[0], after[1]);
      const previous = current.current;
      const nextZoom = oldDistance > 0.1
        ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous.zoom * newDistance / oldDistance))
        : previous.zoom;
      const worldX = (oldCenter.x - previous.x) / previous.zoom;
      const worldY = (oldCenter.y - previous.y) / previous.zoom;
      commit({ x: newCenter.x - worldX * nextZoom, y: newCenter.y - worldY * nextZoom, zoom: nextZoom });
      clickSuppressed.current = true;
      return;
    }
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5) clickSuppressed.current = true;
    if (clickSuppressed.current) {
      if (!transferred.current.has(event.pointerId)) {
        transferred.current.add(event.pointerId);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      const previous = current.current;
      commit({ ...previous, x: previous.x + point.x - pointer.x, y: previous.y + point.y - pointer.y });
    }
  }, [commit]);

  const forgetPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    transferred.current.delete(event.pointerId);
  }, []);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.target !== event.currentTarget && transferred.current.has(event.pointerId)) return;
    forgetPointer(event);
  }, [forgetPointer]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = viewPoint(svg, event.clientX, event.clientY);
      commit(zoomGraphCamera(current.current, Math.exp(-event.deltaY * 0.0015), anchor));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  return {
    camera, reset, zoomBy, focusAt, suppressClick,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: forgetPointer,
      onPointerCancel: forgetPointer,
      onLostPointerCapture,
    },
  };
}
