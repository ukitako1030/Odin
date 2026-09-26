import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ODIN — 思考の聖域',
  description: '知識、計画、ひらめきをひとつの静かな場所に。',
};

export const viewport: Viewport = { viewportFit: 'cover' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
