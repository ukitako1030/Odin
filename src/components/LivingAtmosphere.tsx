'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './LivingAtmosphere.module.css'

type Variant = 'hero' | 'archive' | 'forge' | 'well'

type Props = {
  variant: Variant
  enabled?: boolean
}

// Fixed positions keep the server and client markup identical and make the
// lights feel like part of the scene rather than a newly scattered particle set.
const motes = [
  { x: 8, y: 19, size: 2, delay: -3, duration: 12 },
  { x: 17, y: 69, size: 1, delay: -8, duration: 16 },
  { x: 25, y: 35, size: 2, delay: -6, duration: 14 },
  { x: 36, y: 78, size: 1, delay: -1, duration: 13 },
  { x: 48, y: 16, size: 1, delay: -11, duration: 19 },
  { x: 59, y: 61, size: 2, delay: -4, duration: 17 },
  { x: 69, y: 28, size: 1, delay: -9, duration: 15 },
  { x: 76, y: 79, size: 2, delay: -2, duration: 18 },
  { x: 87, y: 43, size: 1, delay: -12, duration: 20 },
  { x: 94, y: 13, size: 2, delay: -7, duration: 16 },
] as const

export default function LivingAtmosphere({ variant, enabled = true }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [canAnimate, setCanAnimate] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let inView = false
    const sync = () => setCanAnimate(inView && !document.hidden && !media.matches)
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    })

    observer.observe(element)
    media.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    sync()

    return () => {
      observer.disconnect()
      media.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [enabled])

  return (
    <div
      ref={ref}
      className={`${styles.scene} ${styles[variant]}`}
      data-animate={enabled && canAnimate ? 'true' : 'false'}
      aria-hidden="true"
    >
      <span className={`${styles.glow} ${styles.glowOne}`} />
      <span className={`${styles.glow} ${styles.glowTwo}`} />
      <span className={`${styles.beam} ${styles.beamOne}`} />
      <span className={`${styles.beam} ${styles.beamTwo}`} />
      <span className={styles.veil} />
      {motes.map((mote, index) => (
        <span
          key={index}
          className={styles.mote}
          style={{
            left: `${mote.x}%`,
            top: `${mote.y}%`,
            width: mote.size,
            height: mote.size,
            animationDelay: `${mote.delay}s`,
            animationDuration: `${mote.duration}s`,
          }}
        />
      ))}
    </div>
  )
}
