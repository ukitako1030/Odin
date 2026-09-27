'use client';

import Link from 'next/link';
import { LanguageSwitch, useI18n } from '@/components/I18nProvider';
import styles from './setup.module.css';

export default function SetupPage() {
  const { t } = useI18n();
  return <main className={styles.page}>
    <LanguageSwitch/>
    <Link href="/" className={styles.back}>{t('← Odin に戻る')}</Link>
    <p className={styles.eyebrow}>CONNECT YOUR REALM</p>
    <h1>{t('あなたの記憶を、つなぐ。')}</h1>
    <p className={styles.intro}>{t('このPCでの保存から、Google Drive、そしていつものAIへ。必要な接続から始められます。')}</p>
    <section><span>01 / YOUR VAULT</span><h2>{t('まず、このPCで使う')}</h2><p>{t('初期状態では、このPCの')} <code>.odin/vault</code> {t('にMarkdownを保存します。ブラウザーを閉じても記録は残ります。初期のサンプルは編集・削除できます。')}</p><p>{t('この段階では、他の端末との共有やDriveへの同期は行われません。')}</p></section>
    <section><span>02 / GOOGLE DRIVE</span><h2>{t('Driveを保存先にする')}</h2><ol><li>{t('自分のGoogle CloudプロジェクトでGoogle Drive APIを有効にします。')}</li><li>{t('OAuth同意画面と「デスクトップ アプリ」のOAuthクライアントを作ります。長期利用ではTestingのままにせず、公開状態を確認してください。')}</li><li>{t('プロジェクトの')} <code>.env.local</code> {t('に')} <code>GOOGLE_CLIENT_ID</code> {t('と')} <code>GOOGLE_CLIENT_SECRET</code> {t('を設定します。秘密の値をチャットへ貼る必要はありません。')}</li><li>{t('ターミナルで')} <code>npm run setup:drive</code> {t('を実行し、表示された認証URLを開きます。')}</li><li>{t('認証するとOdinフォルダーを作成・確認し、接続設定を保存します。アプリを再起動してください。')}</li></ol><p>{t('既存のローカル記録を移すときは')} <code>npm run migrate:drive</code>{t('。元データを保持し、異なる既存データを上書きせずに移行します。')}</p><p>{t('アプリが作成したファイルを扱う権限を使用します。Driveへ直接置いた任意のMarkdownを自動取り込みする機能は、初版には含まれていません。')}</p></section>
    <section><span>03 / YOUR INTELLIGENCE</span><h2>{t('いつものAIから使う')}</h2><p>{t('CodexやClaude Codeなど、stdio MCPに対応したクライアントには付属のブリッジを登録します。各AIが同じ検索・保存・更新の操作を呼び出せます。')}</p><pre>npm run mcp</pre><p>{t('接続先URLと専用トークンは環境変数で設定します。具体的な設定例はプロジェクトの')} <code>docs/AI-CONNECTIONS.md</code> {t('にあります。')}</p><p>{t('ChatGPTやその他のリモート接続では、利用サービスの対応とOAuthの設定が必要です。接続を確認するまでは「利用可能」とは表示しません。')}</p></section>
    <section><span>04 / EVERYWHERE</span><h2>{t('スマホから使えるようにする')}</h2><p>{t('Vercelなどへ配置すると、同じURLをPC・スマホ・タブレットから開けます。公開前に所有者パスワード・セッション秘密鍵・Drive接続を設定します。')}</p><p>{t('Vercelのような複数の処理が同時に動く環境では、Driveへの書き込みを順番に処理するための共有ロック設定も必要です。記録本体はDriveに残り、ロックには内容を保存しません。')}</p><p>{t('初版の通知は期限の画面表示までです。指定時刻のプッシュ通知とOdin内のAIチャットは含みません。')}</p></section>
    <footer>{t('Muninが覚え、Huginが考える。その全体がOdin。')}</footer>
  </main>;
}
