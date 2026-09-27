import { kindLabels as japaneseKindLabels, type EntryKind } from './types';
import { mainMessages } from './i18n-main';
import { importMessages } from './i18n-import';
import { secondaryMessages } from './i18n-secondary';
import { errorMessages, translateDiagnostic } from './i18n-errors';

export type Locale = 'ja' | 'en';
export const localeCookie = 'odin-language';
export const normalizeLocale = (value?: string): Locale => value === 'en' ? 'en' : 'ja';
export const englishMessages: Record<string, string> = { ...errorMessages, ...mainMessages, ...importMessages, ...secondaryMessages };
export function translate(locale: Locale, source: string, params?: Record<string, string | number>) {
  const message = locale === 'en' ? (Object.hasOwn(englishMessages, source) ? englishMessages[source] : translateDiagnostic(source) ?? source) : source;
  return params ? message.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(params, key) ? String(params[key]) : match) : message;
}
export function localizedKindLabels(locale: Locale): Record<EntryKind, string> {
  return locale === 'ja' ? japaneseKindLabels : { knowledge: 'Knowledge', task: 'Tasks', shopping: 'Shopping', idea: 'Ideas', memo: 'Inbox', project: 'Projects', reminder: 'Reminders' };
}
