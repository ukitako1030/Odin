'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import styles from './BrandWordmark.module.css'

type Props = {
  enabled?: boolean
  compact?: boolean
}

export default function BrandWordmark({ enabled = true, compact = false }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
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
    <span
      ref={ref}
      className={`${styles.wordmark} ${compact ? styles.compact : ''}`}
      data-animate={enabled && canAnimate ? 'true' : 'false'}
    >
      <span className={styles.imageWrap}>
        <Image
          src="/assets/odin-wordmark-silver.webp"
          alt="ODIN"
          width={660}
          height={220}
          unoptimized
          className={styles.image}
        />
        <span className={styles.shimmer} aria-hidden="true" />
      </span>
      {!compact && <span className={styles.caption}>YOUR SECOND MIND</span>}
    </span>
  )
}
