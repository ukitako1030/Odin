import Image from 'next/image';
import LivingAtmosphere from './LivingAtmosphere';
import styles from './RealmScene.module.css';

export type RealmSceneKind = 'archive' | 'compass' | 'well' | 'quill';
const scenes = {
  archive: { image: 'celestial-archive.webp', atmosphere: 'archive' },
  compass: { image: 'journey-compass.webp', atmosphere: 'forge' },
  well: { image: 'memory-well.webp', atmosphere: 'well' },
  quill: { image: 'raven-quill.webp', atmosphere: 'hero' },
} as const;

/** The art stays still; independent light and dust give each place its own life. */
export default function RealmScene({ kind, enabled = true, sizes = '(max-width: 700px) 100vw, 70vw' }: { kind: RealmSceneKind; enabled?: boolean; sizes?: string }) {
  const scene = scenes[kind];
  return <div className={`${styles.scene} ${styles[kind]}`} aria-hidden="true" data-realm-scene={kind}>
    <Image className={styles.art} src={`/assets/${scene.image}`} alt="" fill sizes={sizes} />
    <div className={styles.light}><LivingAtmosphere variant={scene.atmosphere} enabled={enabled}/></div>
    <div className={styles.shade}/>
  </div>;
}
