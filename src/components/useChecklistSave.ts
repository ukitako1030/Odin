'use client';

import { useCallback, useRef, useState } from 'react';
import type { Entry } from '@/lib/types';

type Failure = { id: string; title: string; message: string; conflict: boolean };
type Options = {
  save: (entry: Entry, body: string) => Promise<Entry>;
  read: (id: string) => Promise<Entry>;
  onEntry: (entry: Entry) => void;
};
type Queue = {
  confirmed: Entry;
  desired: string;
  attempted?: string;
  timer?: ReturnType<typeof setTimeout>;
  saving: boolean;
  checking: boolean;
  failure?: Omit<Failure, 'id' | 'title'>;
  version: number;
};

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'チェックを保存できませんでした。';

/** Keeps one confirmed revision and one latest desired body for each entry. */
export function useChecklistSave({ save, read, onEntry }: Options) {
  const callbacks = useRef({ save, read, onEntry });
  callbacks.current = { save, read, onEntry };
  const queues = useRef(new Map<string, Queue>());
  const [, render] = useState(0);
  const changed = useCallback(() => render(value => value + 1), []);

  const persist = useCallback(async (id: string) => {
    const queue = queues.current.get(id);
    if (!queue || queue.saving || queue.checking || queue.failure) return;
    if (queue.timer) { clearTimeout(queue.timer); queue.timer = undefined; }
    if (queue.desired === queue.confirmed.body) {
      queues.current.delete(id);
      callbacks.current.onEntry(queue.confirmed);
      changed();
      return;
    }

    queue.saving = true;
    const attempted = queue.desired;
    queue.attempted = attempted;
    changed();
    try {
      const saved = await callbacks.current.save(queue.confirmed, attempted);
      // An unexpected response must be reconciled with a GET before another PATCH.
      if (saved.id !== id || saved.body !== attempted || saved.revision <= queue.confirmed.revision) {
        throw new Error('保存結果を確認できませんでした。最新の状態を確認してください。');
      }
      queue.confirmed = saved;
      queue.saving = false;
      if (queue.desired === saved.body) {
        queues.current.delete(id);
        callbacks.current.onEntry(saved);
      } else {
        callbacks.current.onEntry({ ...saved, body: queue.desired });
        void persist(id);
      }
      changed();
    } catch (cause) {
      queue.saving = false;
      queue.failure = { message: errorText(cause), conflict: false };
      changed();
    }
  }, [changed]);

  const toggle = useCallback((entry: Entry, body: string) => {
    let queue = queues.current.get(entry.id);
    if (!queue) {
      queue = { confirmed: entry, desired: body, saving: false, checking: false, version: 0 };
      queues.current.set(entry.id, queue);
    } else {
      queue.desired = body;
    }
    queue.version++;
    callbacks.current.onEntry({ ...queue.confirmed, body });
    if (!queue.saving && !queue.checking && !queue.failure) {
      if (queue.timer) clearTimeout(queue.timer);
      queue.timer = setTimeout(() => void persist(entry.id), 350);
    }
    changed();
  }, [changed, persist]);

  const retry = useCallback(async (id: string) => {
    const queue = queues.current.get(id);
    if (!queue?.failure || queue.checking || queue.saving) return;
    queue.checking = true;
    changed();
    try {
      const latest = await callbacks.current.read(id);
      if (latest.id !== id) throw new Error('読み込んだ記録が一致しません。');
      const unchanged = latest.revision === queue.confirmed.revision && latest.body === queue.confirmed.body;
      const attemptedWasSaved = latest.revision > queue.confirmed.revision && latest.body === queue.attempted;
      if (!unchanged && !attemptedWasSaved) {
        queue.failure = { message: '別の変更が保存されています。保存済みの内容を読み込んでください。', conflict: true };
        return;
      }
      queue.confirmed = latest;
      queue.failure = undefined;
      callbacks.current.onEntry({ ...latest, body: queue.desired });
    } catch (cause) {
      queue.failure = { message: errorText(cause), conflict: queue.failure?.conflict ?? false };
      return;
    } finally {
      queue.checking = false;
      changed();
    }
    void persist(id);
  }, [changed, persist]);

  const discard = useCallback(async (id: string) => {
    const queue = queues.current.get(id);
    if (!queue?.failure || queue.checking || queue.saving) return;
    queue.checking = true;
    const version = queue.version;
    changed();
    try {
      const latest = await callbacks.current.read(id);
      if (latest.id !== id) throw new Error('読み込んだ記録が一致しません。');
      // A new click during the GET remains an unsaved choice; never discard it silently.
      if (queue.version !== version) return;
      queues.current.delete(id);
      callbacks.current.onEntry(latest);
    } catch (cause) {
      queue.failure = { message: errorText(cause), conflict: queue.failure?.conflict ?? false };
    } finally {
      queue.checking = false;
      changed();
    }
  }, [changed]);

  const failures: Failure[] = [...queues.current].flatMap(([id, queue]) => queue.failure
    ? [{ id, title: queue.confirmed.title, ...queue.failure }]
    : []);
  const pending = queues.current.size > 0;
  const hasPending = useCallback(() => queues.current.size > 0, []);
  return { toggle, pending, hasPending, failures, retry, discard };
}
