'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { localeCookie, localizedKindLabels, translate, type Locale } from '@/lib/i18n';
import styles from './LanguageSwitch.module.css';
import { I18nContext, useI18n } from './i18n-context';
export { useI18n } from './i18n-context';

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    document.cookie = `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    // Refresh server metadata and prefetched routes without discarding client drafts.
    router.refresh();
  }, [router]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'en' ? 'ODIN — Sanctuary of Thought' : 'ODIN — 思考の聖域';
    document.querySelector('meta[name="description"]')?.setAttribute('content', locale === 'en'
      ? 'A quiet home for your knowledge, plans, and inspiration.' : '知識、計画、ひらめきをひとつの静かな場所に。');
  }, [locale]);
  const t = useCallback((source: string, params?: Record<string, string | number>) => translate(locale, source, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, kindLabels: localizedKindLabels(locale) }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function LanguageSwitch({ showLabel = true }: { showLabel?: boolean }) {
  const { locale, setLocale } = useI18n();
  return <div className={styles.switch} role="group" aria-label="表示言語 / Language">
    {showLabel && <span className={styles.label}>{locale === 'ja' ? '表示言語' : 'Language'}</span>}
    <div className={styles.options}>
      <button type="button" lang="ja" aria-pressed={locale === 'ja'} onClick={() => setLocale('ja')}>日本語</button>
      <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
    </div>
  </div>;
}
