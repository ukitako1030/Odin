import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { I18nProvider } from '@/components/I18nProvider';
import { localeCookie, normalizeLocale } from '@/lib/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = normalizeLocale((await cookies()).get(localeCookie)?.value);
  return { title: locale === 'en' ? 'ODIN — Sanctuary of Thought' : 'ODIN — 思考の聖域',
    description: locale === 'en' ? 'A quiet home for your knowledge, plans, and inspiration.' : '知識、計画、ひらめきをひとつの静かな場所に。' };
}

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = normalizeLocale((await cookies()).get(localeCookie)?.value);
  return <html lang={locale} data-scroll-behavior="smooth"><body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body></html>;
}
