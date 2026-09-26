export const entryKinds = ['knowledge', 'task', 'shopping', 'idea', 'memo', 'project', 'reminder'] as const;
export type EntryKind = typeof entryKinds[number];
export type EntryStatus = 'active' | 'done' | 'archived';
export interface Entry {
  id: string;
  title: string;
  kind: EntryKind;
  body: string;
  tags: string[];
  status: EntryStatus;
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  projectId?: string;
  relatedIds?: string[];
  source?: string;
  revision: number;
  deletedAt?: string;
  isExample?: boolean;
}
export type EntryInput = Pick<Entry, 'title' | 'kind' | 'body' | 'tags'> & Partial<Pick<Entry, 'status' | 'dueAt' | 'projectId' | 'relatedIds' | 'source'>>;
export interface StoreStatus { provider: 'local' | 'drive'; connected: boolean; writable: boolean; message: string; }
export interface EntryRevision { entry: Entry; savedAt: string; }

export const conversationProviders = ['chatgpt', 'claude', 'gemini', 'codex', 'markdown'] as const;
export type ConversationProvider = typeof conversationProviders[number];
export interface ConversationMessage {
  id: string;
  conversationId: string;
  conversationTitle: string;
  provider: ConversationProvider;
  account: string;
  role: 'user' | 'assistant' | 'tool' | 'unknown';
  text: string;
  timestamp?: string;
  sourceFile: string;
  sourceUrl?: string;
  hash: string;
}
export interface ImportWarning { file: string; message: string; }
export interface ParsedConversations { messages: ConversationMessage[]; warnings: ImportWarning[]; files: number; }
export interface ImportSelection {
  from?: string;
  to?: string;
  providers?: ConversationProvider[];
  accounts?: string[];
  excludedConversationIds?: string[];
  includeUndated?: boolean;
}
export interface CandidateEvidence {
  messageId: string;
  quote: string;
}
export interface KnowledgeCandidateInput {
  title: string;
  body: string;
  kind: EntryKind;
  tags: string[];
  evidence: CandidateEvidence[];
  action?: 'create' | 'update' | 'skip';
  targetId?: string;
  expectedRevision?: number;
  note?: string;
}
export interface KnowledgeCandidate extends KnowledgeCandidateInput {
  id: string;
  action: 'create' | 'update' | 'skip';
  state: 'pending' | 'saved' | 'skipped' | 'failed';
  origin: 'extract' | 'external-ai' | 'ai';
  savedEntryId?: string;
  error?: string;
  duplicateIds: string[];
}
export interface ImportBatch {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  status: 'ready' | 'review' | 'completed';
  selection: ImportSelection;
  messages: ConversationMessage[];
  warnings: ImportWarning[];
  candidates: KnowledgeCandidate[];
  files: number;
  purgedAt?: string;
}
export type ImportBatchSummary = Omit<ImportBatch, 'messages' | 'candidates'> & {
  messageCount: number;
  candidateCount: number;
  savedCount: number;
};
export const kindLabels: Record<EntryKind, string> = {knowledge:'ナレッジ', task:'タスク', shopping:'買い物', idea:'アイデア', memo:'Inbox', project:'プロジェクト', reminder:'リマインダー'};
