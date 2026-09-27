'use client';

import { createContext, useContext } from 'react';
import { localizedKindLabels, translate, type Locale } from '@/lib/i18n';

// Keep the language context independent of CSS and navigation so content renderers
// can also be used outside the application shell (including server-rendered tests).
export const I18nContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, params?: Record<string, string | number>) => string;
  kindLabels: ReturnType<typeof localizedKindLabels>;
}>({ locale: 'ja', setLocale: () => {}, t: (source, params) => translate('ja', source, params), kindLabels: localizedKindLabels('ja') });

export function useI18n() {
  return useContext(I18nContext);
}
