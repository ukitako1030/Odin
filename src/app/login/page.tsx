'use client';

import { FormEvent, useEffect, useState } from 'react';
import styles from './login.module.css';
import BrandWordmark from '@/components/BrandWordmark';
import RealmScene from '@/components/RealmScene';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [motion, setMotion] = useState(false);
  useEffect(() => { setMotion(localStorage.getItem('odin-motion') !== 'off'); }, []);
  useEffect(() => { fetch('/api/auth/status', { cache: 'no-store' }).then((r) => r.json()).then((s) => { if (s.authenticated) location.replace('/'); }).catch(() => {}); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'ログインできませんでした。');
      location.replace('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ログインできませんでした。'); setBusy(false); }
  }
  return <main className={styles.screen}>
    <RealmScene kind="archive" enabled={motion} sizes="(min-aspect-ratio: 3/1) 100vw, 300vh"/>
    <section className={styles.card} aria-labelledby="login-title">
      <div className={styles.wordmark}><BrandWordmark enabled={motion}/></div>
      <p className={styles.eyebrow}>YOUR PRIVATE SPACE</p>
      <h1 id="login-title">Odinへようこそ</h1>
      <p className={styles.description}>あなたの記憶と、これからのための場所。</p>
      <form onSubmit={submit}>
        <label htmlFor="password">パスワード</label>
        <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button disabled={busy} type="submit">{busy ? '確認しています…' : 'ログインする'}<span aria-hidden="true">→</span></button>
      </form>
      <p className={styles.footnote}>あなただけの知識とタスクを、安全に。</p>
    </section>
  </main>;
}
