'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import styles from './GraphSky.module.css';

export default function GraphSky({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    const canvas = element?.parentElement;
    if (!element || !canvas) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const sync = () => {
      const active = String(enabled && visible && !document.hidden && !reduced.matches);
      element.dataset.active = active;
      canvas.dataset.skyActive = active;
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(element);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { observer.disconnect(); reduced.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); delete canvas.dataset.skyActive; };
  }, [enabled]);
  return <div ref={ref} className={styles.sky} aria-hidden="true" data-active="false">
    <Image src="/assets/knowledge-nebula.webp" alt="" fill sizes="(max-width: 900px) 100vw, 75vw" className={styles.nebula}/>
    <div className={styles.current}/><div className={styles.dust}/><div className={styles.shade}/>
    <svg className={styles.chart} viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
      <ellipse cx="500" cy="350" rx="448" ry="303"/>
      <ellipse cx="500" cy="350" rx="433" ry="293" strokeDasharray="1 18"/>
      <path d="M500 39v17 M500 644v17 M44 350h18 M938 350h18"/>
      <path d="M180 136l10 10 M810 554l10 10 M180 564l10-10 M810 146l10-10"/>
      <text x="500" y="30" textAnchor="middle">M U N I N</text>
      <text x="500" y="687" textAnchor="middle">THE MEMORY ATLAS</text>
    </svg>
  </div>;
}
