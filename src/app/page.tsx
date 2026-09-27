'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import RealmAtmosphere from '@/components/RealmAtmosphere';
import LivingAtmosphere from '@/components/LivingAtmosphere';
import RealmScene from '@/components/RealmScene';
import BrandWordmark from '@/components/BrandWordmark';
import EntryMarkdown from '@/components/EntryMarkdown';
import { useChecklistSave } from '@/components/useChecklistSave';
import {
  ArrowRight, ArrowUpRight, Bell, BookOpen, Check, CheckSquare, ChevronRight,
  Clock3, Download, Feather, FolderKanban, History, Home, Inbox, Lightbulb, LoaderCircle,
  LogOut, Menu, Pencil, Plus, RotateCcw, Search, Settings, ShoppingBag,
  Sparkles, Trash2, X, Network,
} from 'lucide-react';
import type { Entry, EntryInput, EntryKind, EntryRevision, StoreStatus } from '@/lib/types';
import { kindLabels } from '@/lib/types';
import { searchEntries } from '@/lib/search';
import { useI18n, LanguageSwitch } from '@/components/I18nProvider';

const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph'), { loading: () => <GraphLoading/> });
function GraphLoading() { const { t } = useI18n(); return <div className="loading-block">{t('星図を準備しています…')}</div>; }
type Section = 'home' | EntryKind | 'trash' | 'settings' | 'graph';
type Editor = { entry?: Entry; kind: EntryKind; requestKey: string };
type NavigationState = { depth: number };
const navigationKey = 'odinNavigation';
const isSection = (value: string | null): value is Section => sections.some(item => item.id === value) || value === 'settings' || value === 'trash';
const isKind = (value: string | null): value is EntryKind => value !== null && Object.hasOwn(kindLabels, value);
const sections: { id: Section; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'knowledge', label: 'ナレッジ', icon: BookOpen },
  { id: 'graph', label: '知識の星図', icon: Network },
  { id: 'task', label: 'タスク', icon: CheckSquare },
  { id: 'project', label: 'プロジェクト', icon: FolderKanban },
  { id: 'shopping', label: '買い物', icon: ShoppingBag },
  { id: 'idea', label: 'アイデア', icon: Lightbulb },
  { id: 'memo', label: 'Inbox', icon: Inbox },
  { id: 'reminder', label: 'リマインダー', icon: Bell },
];
const kindDescriptions: Record<EntryKind, string> = {
  knowledge: '集めた知識を、いつでも引き出せる場所に。',
  task: '今日の一歩を、確かな前進に。',
  shopping: '必要なものを、忘れずに。',
  idea: 'まだ形のない着想を、大切に。',
  memo: '思いついた言葉を、ここに預ける。',
  project: '長い旅路の、現在地を見渡す。',
  reminder: '未来の自分へ、合図を残す。',
};
const emptyForm: EntryInput = { title: '', kind: 'memo', body: '', tags: [] };
const TOKYO = 'Asia/Tokyo';
const dateText = (value?: string, locale: 'ja' | 'en' = 'ja') => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: TOKYO, month: 'long', day: 'numeric' }).format(new Date(value)) : '';
const fullDate = (value?: string, locale: 'ja' | 'en' = 'ja') => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: TOKYO, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value)) : '';
const dateInput = (value?: string) => value ? new Intl.DateTimeFormat('sv-SE', { timeZone: TOKYO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
const stripMarkdown = (value: string) => value.replace(/<!--[\s\S]*?-->/g, '').replace(/[#*`>\[\]()_~-]/g, '').replace(/\s+/g, ' ').trim();

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (response.status === 401 && typeof window !== 'undefined') window.location.assign('/login');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || '通信に失敗しました。もう一度お試しください。');
  return data as T;
}

function useDialogFocus(ref: React.RefObject<HTMLElement | null>, open: boolean, initialRef?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const focusable = ref.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href]');
      (initialRef?.current || focusable || ref.current)?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(item => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); ref.current.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLElement>('.top-search')?.focus(); };
  }, [open, ref, initialRef]);
}

export default function Page() {
  const { locale, t, kindLabels } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [trash, setTrash] = useState<Entry[]>([]);
  const [section, setSection] = useState<Section>('home');
  const [listStatus, setListStatus] = useState<'current' | 'archived'>('current');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [graphFocus, setGraphFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; refreshFailed: boolean } | null>(null);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [authMode, setAuthMode] = useState<'configured' | 'local-development' | 'unavailable' | null>(null);
  const [motion, setMotion] = useState(true);
  const [history, setHistory] = useState<EntryRevision[] | null>(null);
  const [revisionPreview, setRevisionPreview] = useState<EntryRevision | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchDialog = useRef<HTMLDivElement>(null);
  const detailDialog = useRef<HTMLDivElement>(null);
  const mutationLock = useRef(false);
  const deepLinkHandled = useRef(false);
  const draftCache = useRef(new Map<string, { form: EntryInput; tagText: string }>());
  const checklistVersion = useRef(0);
  const refreshRequest = useRef<AbortController | null>(null);
  const lastRefreshAt = useRef(0);
  const checklist = useChecklistSave({
    save: async (entry, body) => (await api<{ entry: Entry }>(`/api/entries/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ body, expectedRevision: entry.revision }) })).entry,
    read: async id => (await api<{ entry: Entry }>(`/api/entries/${id}`)).entry,
    onEntry: entry => {
      checklistVersion.current++;
      setEntries(previous => previous.map(value => value.id === entry.id ? entry : value));
      setSelected(previous => previous?.id === entry.id ? entry : previous);
      setHistory(null); setRevisionPreview(null);
    },
  });
  const checklistPending = useRef(checklist.hasPending);
  checklistPending.current = checklist.hasPending;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (checklistPending.current()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useDialogFocus(searchDialog, searchOpen, searchInput);
  useDialogFocus(detailDialog, Boolean(selected));

  const refresh = useCallback(async () => {
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    const version = checklistVersion.current;
    try {
      const [all, connection, auth] = await Promise.allSettled([
        api<{ entries: Entry[] }>('/api/entries?deleted=all', { signal: controller.signal }).then(all => {
          if (!controller.signal.aborted) {
            if (!checklistPending.current() && version === checklistVersion.current) {
              setEntries(all.entries.filter(entry => !entry.deletedAt));
              lastRefreshAt.current = Date.now();
            }
            setTrash(all.entries.filter(entry => !!entry.deletedAt));
            // Render records without waiting for the connection diagnostics.
            setLoading(false);
          }
          return all;
        }),
        api<StoreStatus>('/api/status', { signal: controller.signal }),
        api<{ mode: 'configured' | 'local-development' | 'unavailable' }>('/api/auth/status', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return false;
      if (connection.status === 'fulfilled') setStatus(connection.value);
      if (auth.status === 'fulfilled') setAuthMode(auth.value.mode);
      const failed = [all, connection].find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      setError('');
      return true;
    } catch (cause) {
      lastRefreshAt.current = 0;
      setError(cause instanceof Error ? cause.message : '記録を読み込めませんでした。');
      return false;
    } finally {
      if (!controller.signal.aborted) { setLoading(false); refreshRequest.current = null; }
    }
  }, []);

  useEffect(() => { void refresh(); return () => refreshRequest.current?.abort(); }, [refresh]);
  const restoreView = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('entry');
    const entry = id ? [...entries, ...trash].find(item => item.id === id) : undefined;
    const editorId = params.get('edit');
    const editedEntry = editorId ? [...entries, ...trash].find(item => item.id === editorId) : undefined;
    const editorKind = params.get('new');
    const destination = params.get('section');
    setSection(isSection(destination) ? destination : entry ? (entry.deletedAt ? 'trash' : entry.kind) : 'home');
    setSelected(entry || null);
    setEditor(editedEntry ? { kind: editedEntry.kind, entry: editedEntry, requestKey: params.get('draft') || editorId! } : isKind(editorKind) ? { kind: editorKind, requestKey: params.get('draft') || crypto.randomUUID() } : null);
    setSearchOpen(params.has('search'));
    setSearch(params.get('q') || '');
    setMenuOpen(params.has('menu'));
    setListStatus(params.get('status') === 'archived' || (entry?.status === 'archived' && !params.has('status')) ? 'archived' : 'current');
    setSelectedProject(params.get('project'));
    setGraphFocus(params.get('focus'));
    setListSearch(params.get('filter') || '');
    setHistory(null);
    setRevisionPreview(null);
    if (id && !entry) setError('リンク先の記録が見つかりません。保存先とゴミ箱を確認してください。');
  }, [entries, trash]);
  useEffect(() => {
    if (loading) return;
    if (!deepLinkHandled.current) { deepLinkHandled.current = true; restoreView(); }
    window.addEventListener('popstate', restoreView);
    return () => window.removeEventListener('popstate', restoreView);
  }, [loading, restoreView]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reread = () => {
      clearTimeout(timer);
      // Returning to the tab often emits both focus and visibilitychange.
      timer = setTimeout(() => {
        if (document.hidden || mutationLock.current || refreshRequest.current) return;
        if (lastRefreshAt.current && Date.now() - lastRefreshAt.current < 30_000) return;
        void refresh();
      }, 100);
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => { clearTimeout(timer); window.removeEventListener('focus', reread); document.removeEventListener('visibilitychange', reread); };
  }, [refresh]);
  useEffect(() => { setMotion(localStorage.getItem('odin-motion') !== 'off'); }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!searchOpen) openSearch(); }
      if (event.key === 'Escape' && !mutationLock.current) {
        if (editor) closeOverlay('editor');
        else if (selected) closeOverlay('entry');
        else if (searchOpen) closeOverlay('search');
        else if (menuOpen) closeOverlay('menu');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [editor, selected, searchOpen, menuOpen]);
  useEffect(() => { if (searchOpen) setTimeout(() => searchInput.current?.focus(), 30); }, [searchOpen]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 4500); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { document.body.style.overflow = (searchOpen || editor || selected) ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [searchOpen, editor, selected]);
  useEffect(() => {
    if (!searchOpen && !editor && !selected) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty('--modal-viewport-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--modal-viewport-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--modal-viewport-height');
      document.documentElement.style.removeProperty('--modal-viewport-top');
    };
  }, [searchOpen, editor, selected]);

  const active = useMemo(() => entries.filter(item => item.status !== 'archived' && !item.deletedAt), [entries]);
  const projects = useMemo(() => active.filter(item => item.kind === 'project'), [active]);
  const openTasks = useMemo(() => active.filter(item => item.kind === 'task' && item.status !== 'done'), [active]);
  const recent = useMemo(() => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [entries]);
  const insights = recent.filter(item => item.status !== 'archived' && (item.kind === 'knowledge' || item.kind === 'idea'));
  const [homeLimit, setHomeLimit] = useState(6);
  const homeActions = useMemo(() => active
    .filter(item => ['task', 'reminder', 'shopping'].includes(item.kind) && item.status !== 'done')
    .sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || b.updatedAt.localeCompare(a.updatedAt)), [active]);
  const searchResults = useMemo(() => {
    if (!search.trim()) return recent.slice(0, 6);
    return searchEntries(recent, search).slice(0, 25);
  }, [recent, search]);
  const visible = useMemo(() => {
    const source = section === 'trash' ? trash : entries.filter(item => item.kind === section && (listStatus === 'archived' ? item.status === 'archived' : item.status !== 'archived') && (!selectedProject || section !== 'project' || item.id === selectedProject));
    return searchEntries(source, listSearch);
  }, [section, entries, trash, listSearch, selectedProject, listStatus]);

  function writeView(update: (params: URLSearchParams) => void, replace = false) {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('section')) url.searchParams.set('section', section);
    update(url.searchParams);
    if (url.href === window.location.href) return;
    const current = (window.history.state?.[navigationKey] as NavigationState | undefined)?.depth || 0;
    // Next.js owns its router markers. Let its history wrapper copy those while
    // retaining the other fields from the current entry.
    const state = { ...window.history.state, [navigationKey]: { depth: replace ? current : current + 1 } };
    delete state.__NA;
    delete state._N;
    window.history[replace ? 'replaceState' : 'pushState'](state, '', url);
    restoreView();
  }
  function closeOverlay(name: 'entry' | 'search' | 'editor' | 'menu') {
    const depth = (window.history.state?.[navigationKey] as NavigationState | undefined)?.depth || 0;
    if (depth > 0) { window.history.back(); return; }
    writeView(params => {
      if (name === 'editor') { params.delete('edit'); params.delete('new'); params.delete('draft'); }
      else if (name === 'search') { params.delete('search'); params.delete('q'); }
      else {
        params.delete(name);
        if (name === 'entry' && selected) params.set('section', selected.deletedAt ? 'trash' : selected.kind);
      }
    }, true);
  }
  function navigate(destination: Section, projectId?: string) {
    if (destination === section && !projectId && !selected && !editor && !searchOpen && !menuOpen && listStatus === 'current' && !selectedProject && !listSearch) return;
    writeView(params => {
      params.set('section', destination);
      for (const key of ['entry', 'edit', 'new', 'draft', 'search', 'q', 'menu', 'status', 'project', 'filter', 'focus']) params.delete(key);
      if (projectId) params.set('project', projectId);
    });
    setError('');
  }
  function openSearch() { writeView(params => { params.set('search', '1'); params.delete('entry'); params.delete('edit'); params.delete('new'); params.delete('draft'); params.delete('menu'); }); }
  function openMenu() { writeView(params => { params.set('menu', '1'); params.delete('search'); params.delete('q'); }); }
  function openEntry(item: Entry) {
    writeView(params => { params.set('entry', item.id); params.delete('search'); params.delete('q'); params.delete('edit'); params.delete('new'); params.delete('draft'); params.delete('menu'); });
  }
  function openEditor(kind: EntryKind = section === 'home' || section === 'trash' || section === 'settings' || section === 'graph' ? 'memo' : section, entry?: Entry) {
    if (checklist.hasPending()) { setError('チェックの保存が終わってから編集できます。'); return; }
    writeView(params => {
      params.delete('entry'); params.delete('search'); params.delete('q'); params.delete('menu');
      params.delete('edit'); params.delete('new');
      params.set(entry ? 'edit' : 'new', entry?.id || kind);
      params.set('draft', crypto.randomUUID());
    });
  }
  function changeListStatus(value: 'current' | 'archived') { writeView(params => { if (value === 'archived') params.set('status', value); else params.delete('status'); params.delete('project'); }); }
  function changeListSearch(value: string) { writeView(params => { if (value) params.set('filter', value); else params.delete('filter'); }, true); }
  function changeSearch(value: string) { writeView(params => { if (value) params.set('q', value); else params.delete('q'); }, true); }
  async function mutate(action: () => Promise<unknown>, message = '記録を保存しました。') {
    if (mutationLock.current || checklist.hasPending()) return false;
    mutationLock.current = true; setBusy(true); setError('');
    refreshRequest.current?.abort();
    try {
      await action();
      const refreshed = await refresh();
      if (editor) draftCache.current.delete(editor.requestKey);
      writeView(params => {
        for (const key of ['entry', 'edit', 'new', 'draft']) params.delete(key);
        if (selected && !params.has('section')) params.set('section', selected.deletedAt ? 'trash' : selected.kind);
      }, true);
      setToast({ message, refreshFailed: !refreshed });
      return true;
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。'); return false; }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function toggleDone(item: Entry) {
    await mutate(() => api(`/api/entries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'done' ? 'active' : 'done', expectedRevision: item.revision }) }), item.status === 'done' ? '未完了に戻しました。' : '完了しました。');
  }
  function toggleChecklist(item: Entry, body: string) {
    if (mutationLock.current || item.deletedAt || item.status === 'archived') return;
    checklist.toggle(item, body);
  }
  async function remove(item: Entry) { await mutate(() => api(`/api/entries/${item.id}?expectedRevision=${item.revision}`, { method: 'DELETE' }), 'ゴミ箱へ移しました。'); }
  async function restore(item: Entry) { await mutate(() => api(`/api/entries/${item.id}/restore`, { method: 'POST', body: JSON.stringify({ expectedRevision: item.revision }) }), '記録を元に戻しました。'); }
  async function setArchived(item: Entry) { await mutate(() => api(`/api/entries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'archived' ? 'active' : 'archived', expectedRevision: item.revision }) }), item.status === 'archived' ? 'アーカイブから戻しました。' : 'アーカイブしました。'); }
  async function restoreRevision(item: Entry, previous: EntryRevision) {
    const version = previous.entry;
    await mutate(() => api(`/api/entries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title: version.title, kind: version.kind, body: version.body, tags: version.tags, status: version.status, dueAt: version.dueAt ?? null, projectId: version.projectId ?? null, relatedIds: version.relatedIds ?? null, source: version.source ?? null, expectedRevision: item.revision }) }), '以前の版を新しい版として復元しました。');
  }
  async function loadHistory(item: Entry) {
    try { const result = await api<{ history: EntryRevision[] }>(`/api/entries/${item.id}/history`); setHistory(result.history); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '履歴を読み込めませんでした。'); }
  }
  function setMotionPreference(value: boolean) { setMotion(value); localStorage.setItem('odin-motion', value ? 'on' : 'off'); }

  const checklistNotice = checklist.failures.length > 0 && <div className="checklist-save-status" data-testid="checklist-save-status">
    {checklist.failures.map(failure => <div key={failure.id} role="alert"><span>{failure.title}：{t(failure.message)}</span><div>
      {!failure.conflict && <button type="button" onClick={() => checklist.retry(failure.id)}>{t('再試行')}</button>}
      <button type="button" onClick={() => checklist.discard(failure.id)}>{t('未保存分を取り消して再読み込み')}</button>
    </div></div>)}
  </div>;
  return <div onClickCapture={event => {
    if (checklist.hasPending() && event.target instanceof Element && event.target.closest('a[href]')) {
      event.preventDefault(); event.stopPropagation(); setError('チェックの保存が終わってから移動できます。');
    }
  }} className={`app-shell ${motion ? 'motion-on' : 'motion-off'}`}>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label={t('メインメニュー')}>
      <button className="brand" type="button" aria-label={t('ODIN ホーム')} onClick={() => navigate('home')}><BrandWordmark enabled={motion}/></button>
      <div className="sidebar-rule"><span>ᛟ</span></div>
      <div className="sidebar-section-label">YOUR REALM</div>
      <nav className="main-nav">{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={section === id ? 'page' : undefined}><Icon size={17} strokeWidth={1.6} /><span>{t(label)}</span>{id === 'task' && openTasks.length > 0 && <span className="nav-count">{openTasks.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-section-label">THE ARCHIVE</div><Link href="/import" className="nav-item"><Download size={17} strokeWidth={1.6}/><span>{t('会話を取り込む')}</span></Link><button className={`nav-item ${section === 'trash' ? 'active' : ''}`} onClick={() => navigate('trash')}><Trash2 size={17} strokeWidth={1.6} /><span>{t('ゴミ箱')}</span></button><button className={`nav-item ${section === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={17} strokeWidth={1.6} /><span>{t('設定')}</span></button><div className="sidebar-footer"><span className="sidebar-footer-rune">ᚨ ᛉ ᚱ</span><span>KNOW THYSELF, KNOW THE WORLD</span></div></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label={t('メニューを閉じる')} onClick={() => closeOverlay('menu')} />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-wordmark" type="button" aria-label={t('ODIN ホーム')} onClick={() => navigate('home')}><BrandWordmark compact enabled={motion}/></button><button className="mobile-menu icon-button" aria-label={t('メニューを開く')} onClick={openMenu}><Menu size={22}/></button><div className="breadcrumb"><span>THE SANCTUARY</span><ChevronRight size={12}/><strong>{section === 'home' ? t('ホーム') : section === 'trash' ? t('ゴミ箱') : section === 'settings' ? t('設定') : section === 'graph' ? t('知識の星図') : kindLabels[section]}</strong></div><div className="top-actions"><button className="top-search" aria-label={t('記録を検索')} onClick={openSearch}><Search size={16}/><span>{t('記憶を探す...')}</span><kbd>Ctrl K</kbd></button><button className="new-button" aria-label={t('新しい記録を作成')} onClick={() => openEditor()}><Plus size={17}/><span>{t('記録する')}</span></button></div></header>
      {error && <div className="global-error" role="alert"><span>{t(error)}</span><button onClick={() => { setError(''); refresh(); }} aria-label={t('再読み込み')}><RotateCcw size={16}/></button></div>}
      {!selected && checklistNotice}
      <div className="save-toast" role="status" aria-live="polite">{toast && <>{t(toast.message)}{toast.refreshFailed && ` ${t('一覧の更新に失敗しました。再読み込みしてください。')}`}</>}</div>
      {section === 'home' ? <>
        <section className="hero" aria-labelledby="hero-title"><div className="hero-image"/><div className="hero-vignette"/><div className="realm-weather" aria-hidden="true"><div className="realm-cloud cloud-high"/><div className="realm-cloud cloud-low"/></div><RealmAtmosphere enabled={motion}/><LivingAtmosphere variant="hero" enabled={motion}/><div className="realm-particles" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index}/>)}</div><div className="hero-figure-layer" aria-hidden="true"><div className="hero-figure-scene"><Image unoptimized loading="eager" className="hero-odin" src="/assets/odin-refined-cutout.webp" alt="" width={1280} height={921} fetchPriority="high" draggable={false}/></div></div><div className="hero-raven raven-left" aria-hidden="true"/><div className="hero-raven raven-right" aria-hidden="true"/><div className="raven-name left" aria-hidden="true"><strong>Hugin</strong><span>{t('思考の鴉')}</span></div><div className="raven-name right" aria-hidden="true"><strong>Munin</strong><span>{t('記憶の鴉')}</span></div><div className="hero-content"><div className="eyebrow"><span className="eyebrow-line"/>THE WISDOM WITHIN</div><h1 id="hero-title">{t('思考の果てに、')}<br/><em>{t('新しい世界がある。')}</em></h1><p>{t('知識も、計画も、ひらめきも。')}<br/>{t('あなたのすべてを、ここに。')}</p><button className="hero-search" onClick={openSearch}><Search size={23} strokeWidth={1.4}/><span>{t('あなたの記憶を探す')}</span><span className="hero-search-key">Ctrl K</span><ArrowRight size={21}/></button><div className="hero-footer"><span>ᚨ ᛉ ᚱ</span><i/>THE REALM OF THOUGHT</div></div><div className="hero-bottom-line"/></section>
        <div className="dashboard">
          <div className="dashboard-heading"><div><div className="section-kicker"><span className="ornament">✧</span> THE PATH AHEAD</div><h2>{t('今日の道しるべ')}</h2></div><div className="date-label"><Clock3 size={14}/>{new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: TOKYO, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</div></div>
          {loading ? <div className="loading-block"><LoaderCircle className="spin"/> {t('記憶を呼び起こしています...')}</div> : <div className="dashboard-grid"><section className="today-panel panel"><div className="panel-heading"><div><span className="panel-overline">01 / TO DO</span><h3>{t('やること・買うもの')}</h3></div></div><div className="today-rows">{homeActions.slice(0, homeLimit).map(item => <div className="today-row" key={item.id}><button className="check-control" aria-label={t('{title}を完了にする', { title: item.title })} onClick={() => toggleDone(item)} disabled={busy || checklist.pending}><span/></button><button className="row-main" onClick={() => openEntry(item)}><strong>{item.title}</strong><small>{kindLabels[item.kind]}{item.dueAt ? ` · ${t('{date}まで', { date: dateText(item.dueAt, locale) })}` : ''}{item.isExample ? ` · ${t('サンプル')}` : ''}</small></button><ChevronRight size={16}/></div>)}{!homeActions.length && <div className="quiet-empty"><Sparkles size={20}/><span>{t('未完了のタスク・リマインダー・買い物はありません。')}</span></div>}</div>{homeActions.length > homeLimit && <button className="home-more" onClick={() => setHomeLimit(value => value + 6)}>{t('もっと見る（残り{count}件）', { count: homeActions.length - homeLimit })}</button>}<div className="home-action-links"><button className="panel-link" onClick={() => navigate('task')}>{t('タスク')} <ArrowUpRight size={15}/></button><button className="panel-link" onClick={() => navigate('reminder')}>{t('リマインダー')} <ArrowUpRight size={15}/></button><button className="panel-link" onClick={() => navigate('shopping')}>{t('買い物')} <ArrowUpRight size={15}/></button></div></section>
          <section className="insight-panel panel"><div className="insight-content"><div className="panel-heading"><div><span className="panel-overline">02 / DISCOVERY</span><h3>{t('最近の発見')}</h3></div><Feather size={20} strokeWidth={1.3}/></div>{insights[0] ? <><div className="insight-category">{kindLabels[insights[0].kind]}{insights[0].isExample ? ` · ${t('サンプル')}` : ''}</div><h4>{insights[0].title}</h4><p>{stripMarkdown(insights[0].body) || t('内容を開いて読む')}</p><button className="insight-open" onClick={() => openEntry(insights[0])}>{t('記録を読む')} <ArrowRight size={17}/></button></> : <><h4>{t('新しい発見を記そう')}</h4><p>{t('気になったことや大切な知識を、あなたの言葉で残しましょう。')}</p><button className="insight-open" onClick={() => openEditor('knowledge')}>{t('記録する')} <ArrowRight size={17}/></button></>}</div><RealmScene kind="well" enabled={motion}/></section>
          <section className="projects-panel panel"><div className="panel-heading"><div><span className="panel-overline">03 / JOURNEYS</span><h3>{t('進行中の旅路')}</h3></div><FolderKanban size={19} strokeWidth={1.3}/></div><div className="project-list">{projects.slice(0, 3).map(item => { const tasks = active.filter(e => e.kind === 'task' && e.projectId === item.id); const done = tasks.filter(e => e.status === 'done').length; return <button className="project-row" key={item.id} onClick={() => { navigate('project', item.id); }}><span className="project-glyph">✦</span><span className="project-info"><strong>{item.title}</strong><small>{tasks.length ? t('{done} / {total} 完了', { done, total: tasks.length }) : t('新しい旅路')}</small></span><span className="project-progress"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }}/></span><ArrowUpRight size={15}/></button>; })}{projects.length === 0 && <div className="quiet-empty"><FolderKanban size={20}/><span>{t('新しい旅路を始めましょう。')}</span></div>}</div><button className="panel-link" onClick={() => navigate('project')}>{t('すべてのプロジェクト')} <ArrowUpRight size={15}/></button></section>
          <section className="raven-panel panel"><RealmScene kind="quill" enabled={motion}/><span className="panel-overline">A NOTE FROM THE RAVENS</span><h3>{t('思考を、自由に。')}</h3><p>{t('小さなひらめきも、遠い未来の計画も。')}<br/>{t('ここに残した言葉が、次の一歩を照らす。')}</p><button onClick={() => openEditor('idea')}>{t('ひらめきを記す')} <ArrowRight size={16}/></button></section></div>}
          <div className="lower-note"><span>ᚺ ᚢ ᚷ ᛁ ᚾ</span><p>{t('知ることは、旅を始めること。')}</p><span>ᛗ ᚢ ᚾ ᛁ ᚾ</span></div>
        </div>
      </> : section === 'graph' ? <KnowledgeGraph motion={motion} entries={entries} loading={loading} focusId={graphFocus} onFocus={id => writeView(params => { if (id) params.set('focus', id); else params.delete('focus'); })} onOpen={openEntry}/> : section === 'settings' ? <div className="inner-page">
        <PageHeading motion={motion} scene="archive" kicker="YOUR SANCTUARY" title={t('設定')} subtitle={t('この場所の使い心地を整える。')}/>
        <div className="settings-layout"><div className="settings-card"><div><span className="panel-overline">LANGUAGE</span><h3>{t('表示言語')}</h3><p>{t('使いやすい言語を選べます。')}</p></div><LanguageSwitch showLabel={false}/></div><div className="settings-card"><div><span className="panel-overline">CONVERSATIONS</span><h3>{t('会話を、あなたの知識へ')}</h3><p>{t('ChatGPT・Claude・Gemini・Codexの履歴を期間で選び、根拠付きの知識として残します。')}</p></div><Link href="/import" className="settings-action">{t('会話を取り込む')} <ArrowUpRight size={16}/></Link></div>
          <div className="settings-card"><div><span className="panel-overline">APPEARANCE</span><h3>{t('演出と動き')}</h3><p>{t('ロゴを巡る光、流れる霧、星屑のゆらぎ。静かな世界の動きを楽しめます。')}</p></div><button className={`switch ${motion ? 'on' : ''}`} role="switch" aria-checked={motion} aria-label={t('演出を有効にする')} onClick={() => setMotionPreference(!motion)}><span/></button></div>
          <div className="settings-card"><div><span className="panel-overline">STORAGE</span><h3>{t('保存先')}</h3><p>{status?.message ? t(status.message) : t('保存先を確認しています。')}</p><span className={`connection ${status?.connected ? 'connected' : ''}`}>{status?.connected ? t('接続中') : t('未接続')} · {status?.provider === 'drive' ? 'Google Drive' : t('ローカル')}</span><p>{status?.provider === 'drive' ? t('接続先や権限はセットアップで確認できます。') : t('この環境のローカル保存先を使用しています。別の端末との同期にはセットアップが必要です。')}</p></div><a href="/setup" className="settings-action">{t('保存先の設定')} <ArrowUpRight size={16}/></a></div>
          <div className="settings-card"><div><span className="panel-overline">YOUR DATA</span><h3>{t('データの書き出し')}</h3><p>{t('すべての記録と変更履歴を ZIP ファイルに保存します。')}</p></div><a href="/api/export" className="settings-action"><Download size={16}/> {t('書き出す')}</a></div>
          {authMode === 'configured' && <div className="settings-card"><div><span className="panel-overline">SESSION</span><h3>{t('サインアウト')}</h3><p>{t('この端末のセッションを終了します。')}</p></div><button className="settings-action" onClick={async () => { try { await api('/api/auth/logout', { method: 'POST' }); window.location.assign('/login'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'サインアウトできませんでした。'); } }}><LogOut size={16}/> {t('サインアウト')}</button></div>}
        </div>
      </div> : <div className="inner-page">
        <PageHeading motion={motion} scene={['task', 'shopping', 'reminder', 'project'].includes(section) ? 'compass' : 'archive'} kicker={section === 'trash' ? 'THE FORGOTTEN' : 'THE COLLECTION'} title={section === 'trash' ? t('ゴミ箱') : kindLabels[section]} subtitle={section === 'trash' ? t('消した記録は、ここから戻せます。') : t(kindDescriptions[section])}/>
        <div className="list-toolbar">{section === 'knowledge' && <Link href="/import" className="secondary-action"><Download size={16}/>{t('会話から取り込む')}</Link>}<div className="list-search"><Search size={18}/><input value={listSearch} onChange={e => changeListSearch(e.target.value)} placeholder={t('この場所を検索')} aria-label={t('この場所を検索')}/></div>{section !== 'trash' && <button className="new-button" onClick={() => openEditor(section)}><Plus size={16}/>{t('新しく記録')}</button>}</div>
        {section !== 'trash' && <div className="status-tabs" role="group" aria-label={t('記録の状態')}><button className={listStatus === 'current' ? 'active' : ''} aria-pressed={listStatus === 'current'} onClick={() => changeListStatus('current')}>{t('すべて')}</button><button className={listStatus === 'archived' ? 'active' : ''} aria-pressed={listStatus === 'archived'} onClick={() => changeListStatus('archived')}>{t('アーカイブ')}</button></div>}
        {section === 'project' && selectedProject && <button className="back-link" onClick={() => writeView(params => params.delete('project'))}>← {t('すべてのプロジェクト')}</button>}
        {loading ? <div className="loading-block"><LoaderCircle className="spin"/> {t('記憶を呼び起こしています...')}</div> : <div className="entry-list">{visible.map(item => <EntryRow key={item.id} item={item} open={() => openEntry(item)} toggle={() => toggleDone(item)} restore={() => restore(item)} busy={busy || checklist.pending} inTrash={section === 'trash'} projects={projects}/>)}{visible.length === 0 && <div className="empty-list"><span className="empty-ornament">ᛟ</span><h3>{listSearch ? t('見つかりませんでした') : section === 'trash' ? t('忘れられた記録はありません') : listStatus === 'archived' ? t('アーカイブは空です') : t('最初の記録を残しましょう')}</h3><p>{listSearch ? t('別の言葉で探してみてください。') : section === 'trash' ? t('ここは、まだ静かなままです。') : t(kindDescriptions[section])}</p>{!listSearch && section !== 'trash' && listStatus !== 'archived' && <button onClick={() => openEditor(section)}><Plus size={16}/> {t('記録する')}</button>}</div>}</div>}
        {section === 'project' && selectedProject && <ProjectTasks projectId={selectedProject} entries={active} open={openEntry} add={() => openEditor('task')}/>}
      </div>}
    </main>
    <nav className="mobile-bottom-nav" aria-label={t('スマートフォンのナビゲーション')}>
      <button type="button" className={section === 'home' ? 'active' : ''} aria-current={section === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Home size={21} strokeWidth={1.8}/><span>{t('ホーム')}</span></button>
      <button type="button" className={searchOpen ? 'active' : ''} aria-label={t('記録を検索')} aria-expanded={searchOpen} onClick={openSearch}><Search size={21} strokeWidth={1.8}/><span>{t('検索')}</span></button>
      <button type="button" className="mobile-create" aria-label={t('新しい記録を作成')} onClick={() => openEditor()}><span className="mobile-create-icon"><Plus size={25} strokeWidth={1.8}/></span><span>{t('作成')}</span></button>
      <button type="button" className={section === 'task' ? 'active' : ''} aria-current={section === 'task' ? 'page' : undefined} onClick={() => navigate('task')}><CheckSquare size={21} strokeWidth={1.8}/><span>{t('タスク')}</span></button>
      <button type="button" className={menuOpen || (section !== 'home' && section !== 'task') ? 'active' : ''} aria-label={t('その他の場所を開く')} aria-expanded={menuOpen} onClick={openMenu}><Menu size={21} strokeWidth={1.8}/><span>{t('その他')}</span></button>
    </nav>
    {searchOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeOverlay('search'); }}><div ref={searchDialog} tabIndex={-1} className="search-dialog" role="dialog" aria-modal="true" aria-label={t('記録を検索')}><div className="command-input"><Search size={22}/><input ref={searchInput} value={search} onChange={e => changeSearch(e.target.value)} placeholder={t('知識、計画、ひらめきを探す...')}/><button onClick={() => closeOverlay('search')} aria-label={t('閉じる')}><X size={19}/></button></div><div className="command-caption">{search ? t('{count} 件の記録', { count: searchResults.length }) : t('最近の記録')}</div><div className="command-results">{searchResults.map(item => <button key={item.id} onClick={() => openEntry(item)}><span className="result-icon">{item.kind === 'task' ? <CheckSquare size={18}/> : item.kind === 'knowledge' ? <BookOpen size={18}/> : item.kind === 'project' ? <FolderKanban size={18}/> : <Feather size={18}/>}</span><span><strong>{item.title}</strong><small>{kindLabels[item.kind]}{item.status === 'archived' ? ` · ${t('アーカイブ')}` : ''}{item.isExample ? ` · ${t('サンプル')}` : ''}</small></span><ArrowUpRight size={16}/></button>)}{searchResults.length === 0 && <div className="command-empty">{t('該当する記録はありません。')}</div>}</div><div className="command-footer"><span>{t('ESC で閉じる')}</span><button onClick={() => openEditor('memo')}><Plus size={15}/> {t('新しい記録')}</button></div></div></div>}
    {selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) closeOverlay('entry'); }}><div ref={detailDialog} tabIndex={-1} className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="dialog-top"><span className="dialog-kicker">✧ {kindLabels[selected.kind].toUpperCase()} {selected.isExample ? ` / ${t('サンプル')}` : ''}{selected.status === 'archived' ? ` / ${t('アーカイブ')}` : ''}</span><button className="icon-button" onClick={() => closeOverlay('entry')} disabled={busy} aria-label={t('閉じる')}><X size={20}/></button></div>
      <h2 id="detail-title">{selected.title}</h2>
      <div className="detail-meta"><span><Clock3 size={14}/> {t('更新')}: {fullDate(selected.updatedAt, locale)}</span>{selected.dueAt && <span><Bell size={14}/> {fullDate(selected.dueAt, locale)}</span>}{selected.projectId && <span><FolderKanban size={14}/> {projects.find(p => p.id === selected.projectId)?.title || t('プロジェクト')}</span>}</div>
      {selected.tags.length > 0 && <div className="detail-tags">{selected.tags.map(tag => <span key={tag}># {tag}</span>)}</div>}
      {checklistNotice}
      <div className="detail-body markdown" aria-busy={busy}>{selected.body ? <EntryMarkdown body={selected.body} autoChecklist={selected.kind === 'task' || selected.kind === 'shopping'} disabled={busy || !!selected.deletedAt || selected.status === 'archived'} onToggle={body => void toggleChecklist(selected, body)}/> : <p className="muted">{t('本文はまだありません。')}</p>}</div>
      {selected.source && <>
        <div className="detail-source desktop-source"><strong>{t('出典')}</strong> {/^https?:\/\//i.test(selected.source) ? <a href={selected.source} target="_blank" rel="noopener noreferrer">{selected.source} <ArrowUpRight size={14}/></a> : <span>{selected.source}</span>}</div>
        <details className="detail-source mobile-source"><summary>{t('出典を表示')}</summary><div>{/^https?:\/\//i.test(selected.source) ? <a href={selected.source} target="_blank" rel="noopener noreferrer">{selected.source} <ArrowUpRight size={14}/></a> : <span>{selected.source}</span>}</div></details>
      </>}
      {selected.relatedIds && selected.relatedIds.length > 0 && <div className="related-records"><h3>{t('関連する記録')}</h3>{selected.relatedIds.map(id => { const related = entries.find(item => item.id === id); return related ? <button key={id} onClick={() => openEntry(related)}>{related.title}<ArrowUpRight size={14}/></button> : null; })}</div>}
      {history && <div className="history-list"><h3>{t('変更履歴')}</h3>{history.length ? [...history].reverse().map((revision, index) => <button key={`${revision.entry.revision}-${index}`} onClick={() => setRevisionPreview(revision)}><History size={14}/> {t('第{revision}版 · {date} · {title}', { revision: revision.entry.revision, date: fullDate(revision.savedAt, locale), title: revision.entry.title })}</button>) : <p>{t('過去の変更はありません。')}</p>}{revisionPreview && <div className="revision-preview"><span>{t('第{revision}版の内容', { revision: revisionPreview.entry.revision })}</span><h4>{revisionPreview.entry.title}</h4><div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{revisionPreview.entry.body || t('本文はありません。')}</ReactMarkdown></div>{revisionPreview.entry.revision !== selected.revision && !selected.deletedAt && <button className="secondary-action" onClick={() => restoreRevision(selected, revisionPreview)} disabled={busy || checklist.pending}><RotateCcw size={16}/> {t('この版に戻す')}</button>}</div>}</div>}
      {error && <div className="form-error" role="alert">{t(error)}</div>}
      <div className="detail-actions">{!selected.deletedAt ? <><button className="secondary-action" onClick={() => openEditor(selected.kind, selected)} disabled={busy || checklist.pending}><Pencil size={16}/> {t('編集')}</button>{(selected.kind === 'task' || selected.kind === 'shopping' || selected.kind === 'reminder') && selected.status !== 'archived' && <button className="secondary-action" onClick={() => toggleDone(selected)} disabled={busy || checklist.pending}><Check size={16}/>{selected.status === 'done' ? t('未完了に戻す') : t('完了にする')}</button>}<button className="secondary-action" onClick={() => loadHistory(selected)} disabled={busy || checklist.pending}><History size={16}/> {t('履歴')}</button><button className="secondary-action" onClick={() => setArchived(selected)} disabled={busy || checklist.pending}><FolderKanban size={16}/>{selected.status === 'archived' ? t('アーカイブから戻す') : locale === 'ja' ? 'アーカイブ' : t('アーカイブする')}</button><button className="danger-action" onClick={() => remove(selected)} disabled={busy || checklist.pending}><Trash2 size={16}/> {t('ゴミ箱へ')}</button></> : <button className="secondary-action" onClick={() => restore(selected)} disabled={busy || checklist.pending}><RotateCcw size={16}/> {t('元に戻す')}</button>}</div>
    </div></div>}
    {editor && <EditorDialog key={editor.requestKey} editor={editor} projects={projects} entries={entries} initialProjectId={editor.kind === 'task' ? selectedProject || undefined : undefined} initialDraft={draftCache.current.get(editor.requestKey)} onDraftChange={draft => draftCache.current.set(editor.requestKey, draft)} busy={busy || checklist.pending} error={error} close={() => { if (!busy) { closeOverlay('editor'); setError(''); } }} save={async data => { await mutate(() => editor.entry ? api(`/api/entries/${editor.entry.id}`, { method: 'PATCH', body: JSON.stringify({ ...data, expectedRevision: editor.entry!.revision }) }) : api('/api/entries', { method: 'POST', headers: { 'Idempotency-Key': editor.requestKey }, body: JSON.stringify(data) }), editor.entry ? '変更を保存しました。' : '新しい記録を保存しました。'); }}/>}
  </div>;
}

function PageHeading({ kicker, title, subtitle, scene, motion }: { kicker: string; title: string; subtitle: string; scene: 'archive' | 'compass'; motion: boolean }) { return <div className="page-heading realm-heading"><RealmScene kind={scene} enabled={motion}/><div className="heading-copy"><div className="section-kicker"><span className="ornament">✧</span> {kicker}</div><h1>{title}</h1><p>{subtitle}</p></div></div>; }
function EntryRow({ item, open, toggle, restore, busy, inTrash, projects }: { item: Entry; open: () => void; toggle: () => void; restore: () => void; busy: boolean; inTrash: boolean; projects: Entry[] }) {
  const { locale, t } = useI18n();
  const checkable = item.kind === 'task' || item.kind === 'shopping' || item.kind === 'reminder';
  return <div className={`entry-row ${item.status === 'done' ? 'is-done' : ''}`}><div className="entry-symbol">{checkable ? <button className={`entry-check ${item.status === 'done' ? 'checked' : ''}`} onClick={toggle} disabled={busy || inTrash} aria-label={t(item.status === 'done' ? '{title}を未完了にする' : '{title}を完了にする', { title: item.title })}>{item.status === 'done' && <Check size={13}/>}</button> : item.kind === 'knowledge' ? <BookOpen size={19}/> : item.kind === 'project' ? <FolderKanban size={19}/> : item.kind === 'idea' ? <Lightbulb size={19}/> : <Feather size={19}/>}</div><button className="entry-primary" onClick={open}><strong>{item.title}</strong><span>{stripMarkdown(item.body).slice(0, 130) || t(kindDescriptions[item.kind])}</span><small>{item.isExample && <em>{t('サンプル')}</em>}{item.projectId && projects.find(p => p.id === item.projectId) && <span>{projects.find(p => p.id === item.projectId)!.title}</span>}{item.tags.slice(0, 2).map(tag => <span key={tag}># {tag}</span>)}</small></button><div className="entry-side"><span>{item.dueAt ? dateText(item.dueAt, locale) : dateText(item.updatedAt, locale)}</span>{inTrash ? <button className="row-restore" onClick={restore} disabled={busy} aria-label={t('{title}を元に戻す', { title: item.title })}><RotateCcw size={17}/></button> : <ArrowUpRight size={18}/>}</div></div>;
}
function ProjectTasks({ projectId, entries, open, add }: { projectId: string; entries: Entry[]; open: (entry: Entry) => void; add: () => void }) {
  const { t, kindLabels } = useI18n();
  const linked = entries.filter(item => item.projectId === projectId);
  const tasks = linked.filter(item => item.kind === 'task');
  const notes = linked.filter(item => item.kind !== 'task');
  return <section className="project-tasks"><div><span className="panel-overline">THE NEXT STEPS</span><h2>{t('この旅路のタスク')}</h2></div>{tasks.map(item => <button key={item.id} onClick={() => open(item)}><span className={`mini-check ${item.status === 'done' ? 'checked' : ''}`}>{item.status === 'done' && <Check size={12}/>}</span>{item.title}<ArrowUpRight size={16}/></button>)}{tasks.length === 0 && <p>{t('このプロジェクトのタスクはまだありません。')}</p>}<button className="add-task" onClick={add}><Plus size={16}/> {t('タスクを追加')}</button><div className="project-notes"><span className="panel-overline">COLLECTED THOUGHTS</span><h2>{t('関連する知識と着想')}</h2>{notes.length ? notes.map(item => <button key={item.id} onClick={() => open(item)}><span>{kindLabels[item.kind]}</span>{item.title}<ArrowUpRight size={16}/></button>) : <p>{t('関連する記録はまだありません。記録を編集して、このプロジェクトに紐づけられます。')}</p>}</div></section>;
}
function EditorDialog({ editor, projects, entries, initialProjectId, initialDraft, onDraftChange, busy, error, close, save }: { editor: Editor; projects: Entry[]; entries: Entry[]; initialProjectId?: string; initialDraft?: { form: EntryInput; tagText: string }; onDraftChange: (draft: { form: EntryInput; tagText: string }) => void; busy: boolean; error: string; close: () => void; save: (data: EntryInput) => Promise<void> }) {
  const { t, kindLabels } = useI18n();
  const original = editor.entry;
  const [form, setForm] = useState<EntryInput>(initialDraft?.form || { ...emptyForm, kind: editor.kind, title: original?.title || '', body: original?.body || '', tags: original?.tags || [], dueAt: dateInput(original?.dueAt), projectId: original?.projectId || initialProjectId || undefined, status: original?.status || 'active', source: original?.source || '', relatedIds: original?.relatedIds || [] });
  const [tagText, setTagText] = useState(initialDraft?.tagText ?? (original?.tags || []).join(', '));
  useEffect(() => { onDraftChange({ form, tagText }); }, [form, tagText, onDraftChange]);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus(dialogRef, true, titleRef);
  async function submit(event: FormEvent) { event.preventDefault(); if (busy || !form.title.trim()) return; await save({ ...form, title: form.title.trim(), tags: tagText.split(/[,、]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean), dueAt: form.dueAt ? `${form.dueAt}T00:00:00+09:00` : (original?.dueAt ? null : undefined), projectId: form.kind === 'project' ? (original?.projectId ? null : undefined) : form.projectId || (original?.projectId ? null : undefined), relatedIds: form.relatedIds?.length ? form.relatedIds : (original?.relatedIds?.length ? null : undefined), source: form.source?.trim() || (original?.source ? null : undefined) } as EntryInput); }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}><form ref={dialogRef} tabIndex={-1} className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title" onSubmit={submit}>
    <div className="dialog-top"><span className="dialog-kicker">✧ {original ? 'EDIT A MEMORY' : 'CAPTURE A THOUGHT'}</span><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label={t('閉じる')}><X size={20}/></button></div>
    <h2 id="editor-title">{original ? t('記録を編集する') : t('新しい記録')}</h2><p className="editor-intro">{t('言葉を残して、未来のあなたへ。')}</p>
    <div className="editor-fields"><label>{t('種類')}<select value={form.kind} disabled={busy} onChange={e => setForm({ ...form, kind: e.target.value as EntryKind })}>{(Object.keys(kindLabels) as EntryKind[]).map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
      <label>{t('タイトル')}<input ref={titleRef} required maxLength={140} disabled={busy} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('どんなことを残しますか？')}/></label>
      <label>{t('本文')} <small>{t('Markdown を使えます')}</small><textarea value={form.body} disabled={busy} onChange={e => setForm({ ...form, body: e.target.value })} placeholder={t('ここに書き始める...')} rows={7}/></label>
      <div className="field-row"><label>{t('タグ')} <small>{t('カンマで区切る')}</small><input value={tagText} disabled={busy} onChange={e => setTagText(e.target.value)} placeholder={t('学び, 大切')}/></label><label>{t('日付')}<input type="date" value={form.dueAt || ''} disabled={busy} onChange={e => setForm({ ...form, dueAt: e.target.value })}/></label></div>
      {form.kind !== 'project' && <label>{t('プロジェクト')}<select value={form.projectId || ''} disabled={busy} onChange={e => setForm({ ...form, projectId: e.target.value || undefined })}><option value="">{t('紐づけない')}</option>{projects.filter(project => project.id !== original?.id).map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}
      <label>{t('出典・参照元')}<input value={form.source || ''} disabled={busy} maxLength={1000} onChange={e => setForm({ ...form, source: e.target.value })} placeholder={t('URL または資料名')}/></label>
      <label>{t('関連する記録')} <small>{t('複数選択できます')}</small><select multiple size={Math.min(5, Math.max(2, entries.length))} value={form.relatedIds || []} disabled={busy} onChange={e => setForm({ ...form, relatedIds: [...e.target.selectedOptions].map(option => option.value) })}>{entries.filter(item => item.id !== original?.id && item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{kindLabels[item.kind]} · {item.title}</option>)}</select></label>
      {original && <label>{t('状態')}<select value={form.status || 'active'} disabled={busy} onChange={e => setForm({ ...form, status: e.target.value as Entry['status'] })}><option value="active">{t('進行中')}</option><option value="done">{t('完了')}</option><option value="archived">{t('アーカイブ')}</option></select></label>}
    </div>
    {error && <div className="form-error" role="alert">{t(error)}</div>}
    <div className="editor-actions"><button type="button" className="secondary-action" onClick={close} disabled={busy}>{t('キャンセル')}</button><button type="submit" className="save-button" disabled={busy || !form.title.trim()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} {original ? t('変更を保存') : t('記録する')}</button></div>
  </form></div>;
}
