'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import type { ConversationMessage, ConversationProvider, Entry, EntryKind, ImportBatch, ImportBatchSummary, ImportSelection, KnowledgeCandidate, KnowledgeCandidateInput } from '@/lib/types';
import { conversationProviders, entryKinds } from '@/lib/types';
import { LanguageSwitch, useI18n } from '@/components/I18nProvider';
import styles from './import.module.css';

type ProviderChoice = ConversationProvider | 'auto';
type ApiFailure = Error & { code?: string };
type Notice = { message: string; params?: Record<string, string | number> };

const providerNames: Record<ConversationProvider, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', codex: 'Codex', markdown: 'Markdown / テキスト' };
const statusNames = { ready: '対象を選択', review: '候補を確認', completed: '保存済み' } as const;
const accept = '.zip,.json,.jsonl,.html,.htm,.md,.markdown,.txt';
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

function jstDay(value?: string) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date); }
function readableTime(value: string | undefined, locale: 'ja' | 'en') { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) + ' JST'; }
function errorMessage(error: unknown) {
  const failure = error as ApiFailure;
  if (failure?.code === 'REVISION_CONFLICT' || failure?.code === 'revisionConflict' || failure?.code === 'revision_conflict') return '別の操作で内容が更新されました。最新の状態を読み込み、差分を確認してから再試行してください。';
  return failure instanceof Error ? failure.message : '処理に失敗しました。時間をおいて再試行してください。';
}
async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  if (response.status === 401 && typeof window !== 'undefined') { window.location.assign('/login'); throw new Error('ログインが必要です。'); }
  const data = await response.json().catch(() => ({})) as { error?: string | { message?: string; code?: string }; code?: string };
  if (!response.ok) { const message = typeof data.error === 'string' ? data.error : data.error?.message; const error = new Error(message || `通信に失敗しました (${response.status})`) as ApiFailure; error.code = data.code || (typeof data.error === 'object' ? data.error?.code : undefined); throw error; }
  return data as T;
}
function selectedMessages(batch: ImportBatch, selection: ImportSelection) {
  return batch.messages.filter(message => {
    if (selection.providers && !selection.providers.includes(message.provider)) return false;
    if (selection.accounts && !selection.accounts.includes(message.account)) return false;
    if (selection.excludedConversationIds?.includes(message.conversationId)) return false;
    const day = jstDay(message.timestamp);
    if (!day) return !!selection.includeUndated;
    return (!selection.from || day >= selection.from) && (!selection.to || day <= selection.to);
  });
}
function draftOf(candidate: KnowledgeCandidate): KnowledgeCandidateInput {
  return { title: candidate.title, body: candidate.body, kind: candidate.kind, tags: [...candidate.tags], evidence: candidate.evidence.map(item => ({ ...item })), action: candidate.action, targetId: candidate.targetId, expectedRevision: candidate.expectedRevision, note: candidate.note };
}

export default function ImportPage() {
  const { locale, t, kindLabels: translatedKindLabels } = useI18n();
  const displayTime = (value?: string) => readableTime(value, locale) || t('日時不明');
  const displayDay = (value: string) => new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
  const displayError = (value: string) => {
    const networkFailure = /^通信に失敗しました \((\d+)\)$/.exec(value);
    if (networkFailure) return t('通信に失敗しました ({status})', { status: networkFailure[1] });
    return t(value);
  };
  const count = (value: number) => new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US').format(value);
  const providerLabel = (value: ConversationProvider) => t(providerNames[value]);
  const statusLabel = (value: keyof typeof statusNames) => t(statusNames[value]);
  const [history, setHistory] = useState<ImportBatchSummary[]>([]);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [provider, setProvider] = useState<ProviderChoice>('auto');
  const [account, setAccount] = useState('');
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<ImportSelection>({ includeUndated: false });
  const [activeMessage, setActiveMessage] = useState<string>('');
  const [activeCandidate, setActiveCandidate] = useState<string>('');
  const [candidateDraft, setCandidateDraft] = useState<KnowledgeCandidateInput | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [chosenCandidates, setChosenCandidates] = useState<string[]>([]);
  const [aiText, setAiText] = useState('');
  const [codexAvailable, setCodexAvailable] = useState(false);
  const [codexFrom, setCodexFrom] = useState('');
  const [codexTo, setCodexTo] = useState('');
  const [purgeStep, setPurgeStep] = useState(0);
  const [visibleConversations, setVisibleConversations] = useState(30);
  const [visibleMessages, setVisibleMessages] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const aiFileRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);
  const dirtyRef = useRef(false);
  const translateRef = useRef(t);
  translateRef.current = t;

  const refreshHistory = useCallback(async () => {
    const data = await jsonRequest<{ batches: ImportBatchSummary[] }>('/api/imports');
    setHistory(data.batches);
  }, []);
  const openBatch = useCallback(async (id: string) => {
    if (operationRef.current) return;
    if (dirtyRef.current && !window.confirm(translateRef.current('編集中の変更はまだ反映されていません。破棄して別の取り込みを開きますか？'))) return;
    operationRef.current = true;
    setBusy('読み込み中'); setError(''); setNotice(null);
    try {
      const data = await jsonRequest<{ batch: ImportBatch }>(`/api/imports/${encodeURIComponent(id)}`);
      const entryData = await jsonRequest<{ entries: Entry[] }>('/api/entries').catch(() => null);
      setBatch(data.batch); setSelection(data.batch.selection); setActiveMessage(''); setActiveCandidate(''); setCandidateDraft(null);
      if (entryData) setEntries(entryData.entries);
      setChosenCandidates([]); setAiText(''); setPurgeStep(0); setVisibleConversations(30); setVisibleMessages({});
      window.history.replaceState(null, '', `/import?batch=${encodeURIComponent(data.batch.id)}`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); operationRef.current = false; }
  }, []);
  useEffect(() => {
    let current = true;
    Promise.allSettled([jsonRequest<{ batches: ImportBatchSummary[] }>('/api/imports'), jsonRequest<{ entries: Entry[] }>('/api/entries')]).then(results => {
      if (!current) return;
      if (results[0].status === 'fulfilled') setHistory(results[0].value.batches); else setError(errorMessage(results[0].reason));
      if (results[1].status === 'fulfilled') setEntries(results[1].value.entries);
      setLoading(false);
    });
    return () => { current = false; };
  }, []);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('batch'); if (id) void openBatch(id); }, [openBatch]);
  useEffect(() => { void jsonRequest<{ available: boolean }>('/api/imports/codex').then(data => setCodexAvailable(data.available)).catch(() => setCodexAvailable(false)); }, []);

  const conversationGroups = useMemo(() => {
    if (!batch) return [];
    const map = new Map<string, { id: string; title: string; provider: ConversationProvider; account: string; count: number; from: string; to: string }>();
    for (const message of batch.messages) {
      const key = message.conversationId;
      const item = map.get(key) ?? { id: key, title: message.conversationTitle || '', provider: message.provider, account: message.account, count: 0, from: '', to: '' };
      item.count++;
      const day = jstDay(message.timestamp);
      if (day && (!item.from || day < item.from)) item.from = day;
      if (day && (!item.to || day > item.to)) item.to = day;
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => (b.to || '').localeCompare(a.to || ''));
  }, [batch]);
  const filtered = useMemo(() => batch ? selectedMessages(batch, selection) : [], [batch, selection]);
  const undatedCount = useMemo(() => batch?.messages.filter(item => !jstDay(item.timestamp)).length ?? 0, [batch]);
  const accountNames = useMemo(() => [...new Set(batch?.messages.map(item => item.account).filter(Boolean) ?? [])], [batch]);
  const active = batch?.candidates.find(item => item.id === activeCandidate) ?? null;
  const source = batch?.messages.find(item => item.id === activeMessage) ?? null;
  const target = entries.find(item => item.id === candidateDraft?.targetId) ?? null;
  const draftDirty = !!(active && candidateDraft && JSON.stringify({ ...candidateDraft, tags: tagsText.split(/[,、\n]/).map(tag => tag.trim()).filter(Boolean) }) !== JSON.stringify(draftOf(active)));
  dirtyRef.current = draftDirty;
  useEffect(() => {
    if (!draftDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draftDirty]);

  function chooseFiles(next: FileList | File[]) {
    const additions = Array.from(next).filter(file => /\.(zip|json|jsonl|html?|md|markdown|txt)$/i.test(file.name));
    if (!additions.length) { setError('ZIP、JSON、JSONL、HTML、Markdown、TXTを選んでください。'); return; }
    setFiles(previous => [...previous, ...additions]); setError('');
  }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); chooseFiles(event.dataTransfer.files); }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!files.length || operationRef.current) return;
    if (dirtyRef.current && !window.confirm(t('編集中の変更はまだ反映されていません。破棄して新しい取り込みを開きますか？'))) return;
    operationRef.current = true;
    setBusy('ファイルを読み取り中'); setError(''); setNotice(null);
    try {
      const form = new FormData(); files.forEach(file => form.append('files', file)); form.append('provider', provider);
      if (account.trim()) form.append('account', account.trim()); if (title.trim()) form.append('title', title.trim());
      const data = await jsonRequest<{ batch: ImportBatch }>('/api/imports', { method: 'POST', body: form });
      setFiles([]); if (fileRef.current) fileRef.current.value = '';
      setBatch(data.batch); setSelection(data.batch.selection); setActiveMessage(''); setActiveCandidate(''); setCandidateDraft(null); setChosenCandidates([]); setAiText(''); setPurgeStep(0); setVisibleConversations(30); setVisibleMessages({});
      window.history.replaceState(null, '', `/import?batch=${encodeURIComponent(data.batch.id)}`);
      setNotice({ message: '{count}件の発言を読み取りました。対象範囲を確認してください。', params: { count: data.batch.messages.length } });
      await refreshHistory();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); operationRef.current = false; }
  }
  async function importCodex() {
    if (!codexFrom || !codexTo || codexFrom > codexTo || operationRef.current) return;
    if (dirtyRef.current && !window.confirm(t('編集中の変更はまだ反映されていません。破棄して新しい取り込みを開きますか？'))) return;
    operationRef.current = true;
    setBusy('このPCのCodex履歴を読み取り中'); setError(''); setNotice(null);
    try {
      const data = await jsonRequest<{ batch: ImportBatch }>('/api/imports/codex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: codexFrom, to: codexTo }) });
      setBatch(data.batch); setSelection(data.batch.selection); setActiveMessage(''); setActiveCandidate(''); setCandidateDraft(null); setChosenCandidates([]); setAiText(''); setPurgeStep(0); setVisibleConversations(30); setVisibleMessages({});
      window.history.replaceState(null, '', `/import?batch=${encodeURIComponent(data.batch.id)}`);
      setNotice({ message: '{count}件のCodex発言を読み取りました。対象範囲を確認してください。', params: { count: data.batch.messages.length } });
      await refreshHistory();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); operationRef.current = false; }
  }
  async function patch(payload: Record<string, unknown>, label: string, currentBatch = batch) {
    if (!currentBatch || operationRef.current) return null;
    operationRef.current = true;
    setBusy(label); setError(''); setNotice(null);
    try {
      const data = await jsonRequest<{ batch: ImportBatch }>(`/api/imports/${encodeURIComponent(currentBatch.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, expectedRevision: currentBatch.revision }) });
      setBatch(data.batch); setSelection(data.batch.selection);
      try { await refreshHistory(); } catch { /* The updated batch remains available even if the history list cannot refresh. */ }
      return data.batch;
    } catch (cause) { setError(errorMessage(cause)); return null; } finally { setBusy(''); operationRef.current = false; }
  }
  async function saveSelection() {
    if (!batch) return null;
    if (JSON.stringify(selection) === JSON.stringify(batch.selection)) return operationRef.current ? null : batch;
    if (batch.candidates.some(item => item.state === 'pending' || item.state === 'failed') && !window.confirm(t('対象範囲を変更すると、未保存の候補が消えます。変更を続けますか？'))) return null;
    const result = await patch({ action: 'select', selection }, '対象を保存中'); if (result) setNotice({ message: '対象範囲を保存しました。' }); return result;
  }
  async function createDrafts() {
    if (!batch || !filtered.length) return;
    if (batch.candidates.some(item => item.origin === 'extract' && item.state !== 'saved') && !window.confirm(t('原文から下書きを作り直すと、未保存の下書きが置き換わります。続けますか？'))) return;
    const saved = await saveSelection(); if (!saved) return;
    const result = await patch({ action: 'extract' }, '原文から下書きを作成中', saved);
    if (result) setNotice({ message: '原文を基に下書きを作りました。内容を確認・編集してから保存してください。AIによる要約ではありません。' });
  }
  async function readAiFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try { setAiText(await file.text()); setError(''); } catch { setError('候補ファイルを読み取れませんでした。'); }
  }
  async function importCandidates() {
    if (!batch || !aiText.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(aiText); } catch { setError('候補JSONを読み取れません。構文を確認してください。'); return; }
    const candidates = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown })?.candidates;
    if (!Array.isArray(candidates) || !candidates.length) { setError('JSONに candidates の配列がありません。'); return; }
    for (const item of candidates) {
      if (!item || typeof item !== 'object' || typeof item.title !== 'string' || typeof item.body !== 'string' || !entryKinds.includes(item.kind) || !Array.isArray(item.tags) || !Array.isArray(item.evidence)) {
        setError('候補には title、body、kind、tags、evidence が必要です。'); return;
      }
    }
    const saved = await saveSelection(); if (!saved) return;
    const result = await patch({ action: 'candidates', candidates }, 'AIの候補を確認中', saved);
    if (result) { setAiText(''); setNotice({ message: '{count}件の候補を受け取りました。根拠と内容を確認してください。', params: { count: candidates.length } }); }
  }
  function openCandidate(candidate: KnowledgeCandidate) {
    if (draftDirty && candidate.id !== activeCandidate && !window.confirm(t('編集中の変更はまだ反映されていません。破棄して別の候補を開きますか？'))) return;
    setActiveCandidate(candidate.id); const draft = draftOf(candidate); setCandidateDraft(draft); setTagsText(draft.tags.join('、'));
  }
  function updateDraft(changes: Partial<KnowledgeCandidateInput>) { setCandidateDraft(previous => previous ? { ...previous, ...changes, ...(changes.action && changes.action !== 'update' ? { targetId: undefined, expectedRevision: undefined } : {}) } : previous); }
  async function saveCandidate() {
    if (!active || !candidateDraft) return null;
    const draft = { ...candidateDraft, title: candidateDraft.action === 'update' && target ? target.title : candidateDraft.title, kind: candidateDraft.action === 'update' && target ? target.kind : candidateDraft.kind, tags: tagsText.split(/[,、\n]/).map(tag => tag.trim()).filter(Boolean) };
    const result = await patch({ action: 'edit', candidateId: active.id, candidate: draft }, '候補を保存中');
    if (result) { const updated = result.candidates.find(item => item.id === active.id); if (updated) { setActiveCandidate(updated.id); setCandidateDraft(draftOf(updated)); setTagsText(updated.tags.join('、')); } setNotice({ message: '候補の編集を保存しました。' }); }
    return result;
  }
  async function commit(ids: string[], currentBatch = batch) {
    if (!ids.length) return;
    const result = await patch({ action: 'commit', candidateIds: ids }, 'ナレッジへ保存中', currentBatch);
    if (!result) return;
    const saved = result.candidates.filter(item => ids.includes(item.id) && item.state === 'saved').length;
    const failed = result.candidates.filter(item => ids.includes(item.id) && item.state === 'failed').length;
    setNotice(failed ? { message: '{saved}件を保存しました。{failed}件は失敗しました。内容を確認して再試行できます。', params: { saved, failed } } : { message: '{saved}件を保存しました。', params: { saved } });
    setChosenCandidates([]);
    const updated = result.candidates.find(item => item.id === activeCandidate); if (updated) { setCandidateDraft(draftOf(updated)); setTagsText(updated.tags.join('、')); }
    try { const data = await jsonRequest<{ entries: Entry[] }>('/api/entries'); setEntries(data.entries); } catch { /* Entry list can be refreshed on the next visit. */ }
  }
  async function commitActive() {
    if (!active) return;
    let current = batch;
    if (draftDirty) current = await saveCandidate();
    if (current) await commit([active.id], current);
  }
  async function purge() {
    const result = await patch({ action: 'purge' }, '原文を削除中');
    if (result) { setPurgeStep(0); setNotice({ message: '一時保存した原文を削除しました。元のファイルは削除していません。' }); }
  }
  const requestText = !batch ? '' : locale === 'en'
    ? `Review Odin conversation import batch ${batch.id} with your usual AI and propose knowledge candidates. Use only the dates, services, and conversations selected in Odin. Date range: ${selection.from || 'not specified'} to ${selection.to || 'not specified'} (JST). If MCP is connected, use odin_import_packet to fetch selected messages and odin_import_candidates to submit candidates. If Codex can access Odin's local workspace, run npm run import:ai -- packet --batch ${batch.id} --out .odin/ai-exchange/packet-${batch.id}.json and submit candidates with the same script's propose command. Otherwise, read the JSON packet downloaded from Odin and return JSON in this format: { "candidates": [{ "title": "", "body": "", "kind": "knowledge", "tags": [], "evidence": [{ "messageId": "", "quote": "" }], "action": "create" }] }. To update an existing entry, specify action:"update", targetId, and expectedRevision. Include the exact message ID and a brief evidence quote for each candidate. Do not present unverified claims as facts or revive expired tasks without review. Keep source text and quotes verbatim.`
    : `Odinの会話取り込みバッチ ${batch.id} を、普段使っているAIでナレッジ候補にしてください。対象はOdin画面で選んだ期間・サービス・会話のみです。期間: ${selection.from || '指定なし'} 〜 ${selection.to || '指定なし'}（JST）。MCP接続が使える場合は odin_import_packet でこのバッチの対象発言を取得し、odin_import_candidates へ候補を登録してください。Odinのローカル作業フォルダーを操作できるCodexなら、npm run import:ai -- packet --batch ${batch.id} --out .odin/ai-exchange/packet-${batch.id}.json で対象を取得し、同スクリプトの propose で候補を提出できます。MCPやローカル操作がない場合は、OdinからダウンロードしたJSON packetを読み、{ "candidates": [{ "title": "", "body": "", "kind": "knowledge", "tags": [], "evidence": [{ "messageId": "", "quote": "" }], "action": "create" }] } のJSONで返してください。既存記録を更新する候補は action:"update", targetId, expectedRevision を指定してください。各候補に正確な発言IDと短い根拠抜粋を付け、未確認の事実は断定せず、古い期限のタスクを勝手に復活させないでください。`;
  async function copyRequest() { const saved = await saveSelection(); if (!saved) return; try { await navigator.clipboard.writeText(requestText); setNotice({ message: 'AIへの依頼文をコピーしました。' }); } catch { setError('コピーできませんでした。依頼文を選択してコピーしてください。'); } }
  async function downloadPacket() {
    if (!batch) return;
    const saved = await saveSelection(); if (!saved) return;
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy('対象JSONを準備中');
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(saved.id)}/packet`, { cache: 'no-store' });
      if (response.status === 401) { window.location.assign('/login'); throw new Error('ログインが必要です。'); }
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string | { message?: string } }; throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '対象JSONを取得できませんでした。'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `odin-import-${saved.id}.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ message: '選択した発言のJSONをダウンロードしました。' });
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); operationRef.current = false; }
  }
  const includedConversations = conversationGroups.filter(group => !selection.excludedConversationIds?.includes(group.id));

  return <main className={styles.page}>
    <header className={styles.topbar}><Link href="/" className={styles.back}>{t('← Odinへ戻る')}</Link><span className={styles.topBrand}>ODIN <i>／</i> MUNIN ARCHIVE</span></header>
    <div className={styles.shell}>
      <div style={{ width: 'min(calc(100% - 36px), 260px)', marginLeft: 'auto', marginRight: 18 }}><LanguageSwitch /></div>
      <section className={styles.hero}><div className={styles.heroText}><p className={styles.eyebrow}>CONVERSATION → KNOWLEDGE</p><h1>{t('会話から、')}<br /><em>{t('残すべき記憶へ。')}</em></h1><p>{t('ChatGPT・Codex・Claude・Geminiなどの履歴を読み込み、期間を選び、根拠を確かめてからOdinへ保存します。')}</p></div><div className={styles.heroRune} aria-hidden="true">ᛟ</div></section>
      <div className={styles.content}>
        {error && <div className={styles.error} role="alert"><span>{displayError(error)}</span><button type="button" onClick={() => { setError(''); if (batch) void openBatch(batch.id); else void refreshHistory().catch(cause => setError(errorMessage(cause))); }}>{t('最新の状態を読み込む')}</button></div>}
        {notice && <div className={styles.notice} role="status">{t(notice.message, notice.params)}<button type="button" aria-label={t('通知を閉じる')} onClick={() => setNotice(null)}>×</button></div>}
        {busy && <div className={styles.progress} role="status"><span className={styles.spinner} />{t(busy)}</div>}
        <nav className={styles.steps} aria-label={t('取り込みの手順')}><span className={!batch ? styles.stepActive : ''}>{t('01 履歴を追加')}</span><span className={batch && !batch.candidates.length ? styles.stepActive : ''}>{t('02 対象を選ぶ')}</span><span className={batch?.candidates.length ? styles.stepActive : ''}>{t('03 候補を確認・保存')}</span></nav>

        <section className={styles.twoColumns}>
          <div className={styles.panel}><div className={styles.sectionTitle}><span>01 / SOURCE</span><h2>{t('履歴ファイルを追加')}</h2></div><p className={styles.muted}>{t('書き出したZIPやJSON、ローカル履歴、Markdownなどを複数まとめて追加できます。解析できない部分は警告として表示します。')}</p>
            <form onSubmit={upload}>
              <div className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                <span className={styles.dropIcon}>＋</span><strong>{t('ここにファイルをドロップ')}</strong><span>{t('または')}</span><button type="button" className={styles.secondary} onClick={() => fileRef.current?.click()}>{t('ファイルを選ぶ')}</button><small>ZIP・JSON・JSONL・HTML・MD・TXT</small>
                <input ref={fileRef} className={styles.srOnly} type="file" accept={accept} multiple onChange={event => { if (event.target.files) chooseFiles(event.target.files); }} aria-label={t('会話履歴ファイル')} />
              </div>
              {files.length > 0 && <ul className={styles.fileList}>{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={t('{name}を外す', {name: file.name})} onClick={() => setFiles(previous => previous.filter((_, item) => item !== index))}>×</button></li>)}</ul>}
              <div className={styles.formGrid}><label>{t('サービス')}<select value={provider} onChange={event => setProvider(event.target.value as ProviderChoice)}><option value="auto">{t('自動判定')}</option>{conversationProviders.map(item => <option value={item} key={item}>{providerLabel(item)}</option>)}</select></label><label>{t('アカウント識別名')} <small>{t('任意')}</small><input value={account} onChange={event => setAccount(event.target.value)} placeholder={t('例: 個人用')} /></label></div>
              <label className={styles.field}>{t('取り込み名')} <small>{t('任意')}</small><input value={title} onChange={event => setTitle(event.target.value)} placeholder={t('例: 2026年 夏の会話')} /></label>
              <button className={styles.primary} type="submit" disabled={!files.length || !!busy}>{t('履歴を読み込む')}<span>→</span></button>
            </form>
            {codexAvailable && <div className={styles.codexLocal}><h3>{t('このPCのCodex履歴から')}</h3><p>{t('ローカルのセッション履歴を読み取ります。読み取り対象の日付を指定してください。')}</p><div className={styles.formGrid}><label>{t('開始日')}<small>JST</small><input type="date" value={codexFrom} max={codexTo || undefined} onChange={event => setCodexFrom(event.target.value)} /></label><label>{t('終了日')}<small>JST</small><input type="date" value={codexTo} min={codexFrom || undefined} onChange={event => setCodexTo(event.target.value)} /></label></div><button type="button" className={styles.secondary} disabled={!codexFrom || !codexTo || codexFrom > codexTo || !!busy} onClick={() => void importCodex()}>{t('このPCのCodex履歴を読み込む →')}</button></div>}
          </div>
          <div className={styles.panel}><div className={styles.sectionTitle}><span>CONTINUE</span><h2>{t('取り込み履歴')}</h2></div>
            {loading ? <p className={styles.muted}>{t('履歴を読み込み中…')}</p> : history.length ? <div className={styles.historyList}>{history.map(item => <button key={item.id} type="button" className={`${styles.historyItem} ${batch?.id === item.id ? styles.historyActive : ''}`} onClick={() => void openBatch(item.id)}><span><strong>{item.title}</strong><small>{displayTime(item.createdAt)} · {t('{count}ファイル', {count: count(item.files)})}</small></span><span className={styles.historyMeta}>{t('{count}発言', {count: count(item.messageCount)})}<br />{t('{saved}/{total}保存', {saved: count(item.savedCount), total: count(item.candidateCount)})}</span><span className={styles.historyStatus}>{statusLabel(item.status)}</span></button>)}</div> : <div className={styles.empty}><span>ᛗ</span><p>{t('取り込み履歴はまだありません。')}</p><small>{t('ファイルを追加すると、途中から再開できます。')}</small></div>}
          </div>
        </section>

        {batch && <>
          <section className={styles.batchHeader}><div><span className={styles.eyebrow}>ACTIVE BATCH / {batch.id.slice(0, 8)}</span><h2>{batch.title}</h2><p>{t('{count}ファイル', {count: count(batch.files)})} · {t('{count}発言', {count: count(batch.messages.length)})} · {t('{count}会話', {count: count(conversationGroups.length)})}{batch.purgedAt ? t(' · 原文削除済み') : ''}</p></div><div className={styles.buttonRow}><button type="button" className={styles.secondary} disabled={!!busy} onClick={() => void openBatch(batch.id)}>{t('最新の候補を読み込む')}</button><span className={styles.batchStatus}>{statusLabel(batch.status)}</span></div></section>
          {batch.warnings.length > 0 && <details className={styles.warnings}><summary>{t('読み取り時の警告 {count}件', {count: count(batch.warnings.length)})}</summary><ul>{batch.warnings.map((item, index) => <li key={index}><strong>{item.file}</strong> — {t(item.message)}</li>)}</ul></details>}
          <section className={styles.panel}><div className={styles.sectionTitle}><span>02 / SCOPE</span><h2>{t('残したい範囲を選ぶ')}</h2></div><p className={styles.muted}>{t('発言日時を日本時間で判定します。日付がない発言は明示的に選んだ場合のみ含めます。')}</p>
            <div className={styles.scopeGrid}><label>{t('開始日')}<small>JST</small><input type="date" value={selection.from ?? ''} max={selection.to || undefined} onChange={event => setSelection(previous => ({ ...previous, from: event.target.value || undefined }))} /></label><label>{t('終了日')}<small>JST</small><input type="date" value={selection.to ?? ''} min={selection.from || undefined} onChange={event => setSelection(previous => ({ ...previous, to: event.target.value || undefined }))} /></label><fieldset><legend>{t('サービス')}</legend><div className={styles.checkRow}>{conversationProviders.filter(item => batch.messages.some(message => message.provider === item)).map(item => { const all = selection.providers === undefined; const checked = all || selection.providers?.includes(item); return <label key={item}><input type="checkbox" checked={!!checked} onChange={() => { const current = all ? conversationProviders.filter(providerName => batch.messages.some(message => message.provider === providerName)) : selection.providers!; const next = checked ? current.filter(value => value !== item) : [...current, item]; setSelection(previous => ({ ...previous, providers: next })); }} />{providerLabel(item)}</label>; })}</div></fieldset></div>
            {accountNames.length > 0 && <fieldset className={styles.accountField}><legend>{t('アカウント')}</legend><div className={styles.checkRow}>{accountNames.map(name => { const all = selection.accounts === undefined; const checked = all || selection.accounts?.includes(name); return <label key={name}><input type="checkbox" checked={!!checked} onChange={() => { const current = all ? accountNames : selection.accounts!; const next = checked ? current.filter(value => value !== name) : [...current, name]; setSelection(previous => ({ ...previous, accounts: next })); }} />{name}</label>; })}</div></fieldset>}
            <label className={styles.toggle}><input type="checkbox" checked={!!selection.includeUndated} onChange={event => setSelection(previous => ({ ...previous, includeUndated: event.target.checked }))} />{t('日時不明の発言も含める')}<span>{t('{count}件', {count: count(undatedCount)})}</span></label>
            <div className={styles.scopeTotal}><span>{t('今回の対象')}</span><strong>{count(filtered.length)}<small> {t('発言')}</small></strong><span>{t('{count}会話', {count: count(includedConversations.length)})}</span></div>
            <div className={styles.buttonRow}><button className={styles.secondary} type="button" disabled={!!busy} onClick={() => void saveSelection()}>{t('対象を保存')}</button><button className={styles.primary} type="button" disabled={!filtered.length || !!busy} onClick={() => void createDrafts()}>{t('原文から下書きを作る')}<span>→</span></button></div>
          </section>

          <section id="source-section" className={styles.sourceSection}><div className={styles.panel}><div className={styles.sectionTitle}><span>CONVERSATIONS</span><h2>{t('会話と原文')}</h2></div><p className={styles.muted}>{t('チェックを外すと会話全体を対象から除きます。原文を開いて内容を確認できます。')}</p>
            {batch.purgedAt ? <div className={styles.empty}>{t('一時保存した原文は削除済みです。')}</div> : conversationGroups.length ? <div className={styles.conversationList}>{conversationGroups.slice(0, visibleConversations).map(group => {
              const excluded = !!selection.excludedConversationIds?.includes(group.id);
              const messages = batch.messages.filter(item => item.conversationId === group.id && selectedMessages(batch, { ...selection, excludedConversationIds: [] }).includes(item));
              return <div className={styles.conversation} key={group.id}><label className={styles.conversationLabel}><input type="checkbox" checked={!excluded} onChange={() => setSelection(previous => ({ ...previous, excludedConversationIds: excluded ? (previous.excludedConversationIds ?? []).filter(id => id !== group.id) : [...(previous.excludedConversationIds ?? []), group.id] }))} /><span><strong>{group.title || t('無題の会話')}</strong><small>{providerLabel(group.provider)} · {t('{count}発言', {count: count(group.count)})} · {group.from ? displayDay(group.from) : t('日時不明')}{group.to && group.to !== group.from ? ` – ${displayDay(group.to)}` : ''}</small></span></label><details><summary>{t('原文を開く')}<span>{t('{count}件が期間内', {count: count(messages.length)})}</span></summary><div className={styles.messageList}>{messages.length ? messages.slice(0, visibleMessages[group.id] ?? 30).map(message => <button key={message.id} type="button" className={activeMessage === message.id ? styles.messageActive : ''} onClick={() => setActiveMessage(message.id)}><span>{message.role === 'user' ? t('あなた') : message.role === 'assistant' ? 'AI' : message.role} · {displayTime(message.timestamp)}</span><strong>{message.text.slice(0, 110) || t('（本文なし）')}</strong></button>) : <p className={styles.muted}>{t('現在の条件に合う発言はありません。')}</p>}{messages.length > (visibleMessages[group.id] ?? 30) && <button type="button" onClick={() => setVisibleMessages(previous => ({ ...previous, [group.id]: (previous[group.id] ?? 30) + 30 }))}>{t('さらに30件表示 ↓')}</button>}</div></details></div>;
            })}{conversationGroups.length > visibleConversations && <button className={styles.showMore} type="button" onClick={() => setVisibleConversations(value => value + 30)}>{t('会話をさらに30件表示 ↓')}</button>}</div> : <div className={styles.empty}>{t('読み取れた会話はありません。警告を確認してください。')}</div>}
          </div><div className={styles.panel}><div className={styles.sectionTitle}><span>ORIGINAL MESSAGE</span><h2>{t('発言の詳細')}</h2></div>{source ? <article className={styles.sourceDetail}><div><strong>{source.conversationTitle}</strong><small>{providerLabel(source.provider)} · {source.role === 'user' ? t('あなた') : source.role === 'assistant' ? 'AI' : source.role} · {displayTime(source.timestamp)}</small></div><pre>{source.text}</pre><small>{t('出典:')} {source.sourceFile} · ID: {source.id}</small></article> : <div className={styles.empty}>{t('左の会話から発言を選ぶと、原文を確認できます。')}</div>}</div></section>

          <section className={styles.panel}><div className={styles.sectionTitle}><span>03 / INTELLIGENCE</span><h2>{t('いつものAIで候補を作る')}</h2></div><div className={styles.aiGrid}><div><p>{t('選んだ発言だけをJSONに書き出し、普段使うCodexなどへ渡せます。MCP接続がある場合は依頼文のツール名を利用できます。接続状態はここでは確認していません。')}</p><div className={styles.buttonRow}><button className={styles.secondary} type="button" disabled={!filtered.length || !!busy} onClick={() => void downloadPacket()}>{t('対象JSONをダウンロード ↓')}</button><button className={styles.secondary} type="button" onClick={() => void copyRequest()}>{t('依頼文をコピー')}</button></div><details className={styles.promptDetails}><summary>{t('依頼文を表示')}</summary><textarea readOnly value={requestText} rows={8} aria-label={t('AIへの依頼文')} /></details></div><div><label className={styles.field}>{t('AIが返した候補JSONを貼る')}<textarea value={aiText} onChange={event => setAiText(event.target.value)} rows={7} placeholder={'{"candidates": [{"title": "...", "body": "...", "kind": "knowledge", "tags": [], "evidence": [{"messageId": "...", "quote": "..."}]}]}'} /></label><div className={styles.buttonRow}><input ref={aiFileRef} className={styles.srOnly} type="file" accept=".json,application/json" aria-label={t('AI候補のJSONファイル')} onChange={event => void readAiFile(event)} /><button type="button" className={styles.secondary} onClick={() => aiFileRef.current?.click()}>{t('JSONファイルを選ぶ')}</button><button type="button" className={styles.primary} disabled={!aiText.trim() || !!busy} onClick={() => void importCandidates()}>{t('候補を受け取る →')}</button></div></div></div></section>

          <section className={styles.reviewSection}><div className={styles.sectionTitle}><span>04 / REVIEW & SAVE</span><h2>{t('候補を確認して保存')}</h2></div><p className={styles.muted}>{t('原文と根拠、既存記録との差分を確認してください。個別保存では編集中の内容も反映します。一括保存の前は「編集を反映」を押してください。')}</p>
            {batch.candidates.length ? <div className={styles.reviewLayout}><div className={styles.candidateList}><div className={styles.listToolbar}><label><input type="checkbox" checked={batch.candidates.filter(item => item.state === 'pending' || item.state === 'failed').length > 0 && batch.candidates.filter(item => item.state === 'pending' || item.state === 'failed').every(item => chosenCandidates.includes(item.id))} onChange={event => setChosenCandidates(event.target.checked ? batch.candidates.filter(item => item.state === 'pending' || item.state === 'failed').map(item => item.id) : [])} />{t('選択')}</label><button type="button" className={styles.secondary} disabled={!chosenCandidates.length || !!busy || draftDirty} title={draftDirty ? t('編集中の候補を先に反映してください') : undefined} onClick={() => void commit(chosenCandidates)}>{t('{count}件を保存', {count: count(chosenCandidates.length)})}</button></div>{draftDirty && <p className={styles.inlineHint}>{t('一括保存の前に、編集中の候補を反映してください。')}</p>}{batch.candidates.map(candidate => <div className={`${styles.candidateRow} ${activeCandidate === candidate.id ? styles.candidateActive : ''}`} key={candidate.id}><input type="checkbox" aria-label={t('{title}を保存対象に選ぶ', {title: candidate.title})} checked={chosenCandidates.includes(candidate.id)} disabled={candidate.state === 'saved' || candidate.state === 'skipped'} onChange={event => setChosenCandidates(previous => event.target.checked ? [...previous, candidate.id] : previous.filter(id => id !== candidate.id))} /><button type="button" onClick={() => openCandidate(candidate)}><span>{t(candidate.action === 'update' ? '追記' : candidate.action === 'skip' ? '見送り' : '新規')} · {translatedKindLabels[candidate.kind]} <em>{t(candidate.state === 'saved' ? '保存済み' : candidate.state === 'failed' ? '失敗' : candidate.state === 'skipped' ? '見送り' : '確認待ち')}</em></span><strong>{candidate.title}</strong><small>{t('{count}件の根拠', {count: count(candidate.evidence.length)})} {candidate.duplicateIds.length ? t('· 重複候補 {count}件', {count: count(candidate.duplicateIds.length)}) : ''}</small></button></div>)}</div>
              <div className={styles.candidateDetail}>{active && candidateDraft ? <><div className={styles.detailHead}><span>{t(active.origin === 'extract' ? '原文からの下書き' : 'AIから受け取った候補')}</span><span>{t(active.state === 'saved' ? '保存済み' : active.state === 'failed' ? '保存失敗' : '編集可能')}</span></div>{active.error && <div className={styles.error} role="alert">{displayError(active.error)}</div>}{active.savedEntryId && <Link className={styles.savedLink} href={`/?entry=${encodeURIComponent(active.savedEntryId)}`}>{t('保存した記録を開く ↗')}</Link>}
                <label className={styles.field}>{t('タイトル')}<input value={candidateDraft.action === 'update' && target ? target.title : candidateDraft.title} onChange={event => updateDraft({ title: event.target.value })} disabled={active.state === 'saved' || candidateDraft.action === 'update'} /></label><div className={styles.formGrid}><label>{t('種類')}<select value={candidateDraft.action === 'update' && target ? target.kind : candidateDraft.kind} onChange={event => updateDraft({ kind: event.target.value as EntryKind })} disabled={active.state === 'saved' || candidateDraft.action === 'update'}>{entryKinds.map(item => <option key={item} value={item}>{translatedKindLabels[item]}</option>)}</select></label><label>{t('扱い')}<select value={candidateDraft.action ?? 'create'} onChange={event => updateDraft({ action: event.target.value as 'create' | 'update' | 'skip' })} disabled={active.state === 'saved'}><option value="create">{t('新規')}</option><option value="update">{t('既存に追記')}</option><option value="skip">{t('見送る')}</option></select></label></div><label className={styles.field}>{t(candidateDraft.action === 'update' ? '追記する本文' : '本文')}<textarea rows={11} value={candidateDraft.body} onChange={event => updateDraft({ body: event.target.value })} disabled={active.state === 'saved'} /></label><label className={styles.field}>{t('タグ')}<small>{t('読点またはカンマ区切り。追記時は既存タグと統合')}</small><input value={tagsText} onChange={event => setTagsText(event.target.value)} disabled={active.state === 'saved'} /></label>
                {candidateDraft.action === 'update' && <><label className={styles.field}>{t('追記する既存記録')}<select value={candidateDraft.targetId ?? ''} onChange={event => { const entry = entries.find(item => item.id === event.target.value); updateDraft({ targetId: entry?.id, expectedRevision: entry?.revision, title: entry?.title ?? candidateDraft.title, kind: entry?.kind ?? candidateDraft.kind }); }} disabled={active.state === 'saved'}><option value="">{t('記録を選ぶ')}</option>{entries.map(item => <option key={item.id} value={item.id}>{item.title} (v{item.revision})</option>)}</select></label>{target && <div className={styles.diffGrid}><div><strong>{t('現在の記録')} · v{target.revision}</strong><h4>{target.title}</h4><pre>{target.body}</pre></div><div><strong>{t('追記後の本文')}</strong><h4>{target.title}</h4><pre>{target.body.trim() ? `${target.body.trimEnd()}\n\n${candidateDraft.body}` : candidateDraft.body}</pre></div></div>}<p className={styles.muted}>{t('更新では既存の本文に追記します。タイトル・種類は維持されます。全体を書き換える場合は保存後に記録を編集してください。')}</p></>}
                <label className={styles.field}>{t('確認メモ')}<small>{t('任意')}</small><textarea rows={2} value={candidateDraft.note ?? ''} onChange={event => updateDraft({ note: event.target.value })} disabled={active.state === 'saved'} /></label><div className={styles.evidence}><h3>{t('根拠の抜粋')}</h3>{active.evidence.length ? active.evidence.map((item, index) => { const message = batch.messages.find(record => record.id === item.messageId); return <div key={`${item.messageId}-${index}`}><blockquote>{item.quote}</blockquote><small>{message ? `${providerLabel(message.provider)} · ${message.conversationTitle} · ${displayTime(message.timestamp)}` : `${t('発言 ID:')} ${item.messageId}`}</small>{message && <button type="button" onClick={() => { setActiveMessage(message.id); document.getElementById('source-section')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('原文を開く ↗')}</button>}</div>; }) : <p>{t('根拠がありません。保存前に出典を確認してください。')}</p>}</div>
                {active.duplicateIds.length > 0 && <div className={styles.duplicates}><h3>{t('重複の可能性')}</h3>{active.duplicateIds.map(id => { const entry = entries.find(item => item.id === id); return <Link key={id} href={`/?entry=${encodeURIComponent(id)}`}>{entry?.title ?? id} ↗</Link>; })}</div>}
                {active.state !== 'saved' && active.state !== 'skipped' && <div className={styles.buttonRow}><button type="button" className={styles.secondary} disabled={!!busy} onClick={() => void saveCandidate()}>{t('編集を反映')}</button><button type="button" className={styles.primary} disabled={!!busy} onClick={() => void commitActive()}>{t(candidateDraft.action === 'skip' ? 'この候補を見送る' : active.state === 'failed' ? '再試行する' : 'この候補を保存')} →</button></div>}</> : <div className={styles.empty}>{t('左の候補を選ぶと、内容と根拠を確認できます。')}</div>}</div></div> : <div className={styles.empty}><span>ᚱ</span><p>{t('候補はまだありません。')}</p><small>{t('原文から下書きを作るか、AIの候補JSONを受け取ってください。')}</small></div>}
          </section>

          {!batch.purgedAt && <section className={styles.retention}><div><h2>{t('一時保存した原文')}</h2><p>{t('候補の確認が終わったら、この取り込みバッチに保管された原文を削除できます。元のファイルと、記録・候補に含まれる根拠抜粋は残ります。')}</p></div>{purgeStep === 0 ? <button className={styles.dangerQuiet} type="button" onClick={() => setPurgeStep(1)}>{t('原文の削除を検討する')}</button> : <div className={styles.purgeConfirm}><p>{t('このバッチの原文を削除します。以後、原文の再確認や候補の再抽出はできません。')}</p><div className={styles.buttonRow}><button className={styles.secondary} type="button" onClick={() => setPurgeStep(0)}>{t('やめる')}</button><button className={styles.danger} type="button" disabled={!!busy} onClick={() => void purge()}>{t('原文を削除する')}</button></div></div>}</section>}
        </>}
      </div>
    </div>
  </main>;
}
