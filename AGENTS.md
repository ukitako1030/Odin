# Odin development

- 日本語を基本に、黒・深い青・紫と北欧神話の世界観を維持する。
- 共通データ契約は `src/lib/types.ts`。Web/REST/MCPは `src/lib/entries.ts` を介する。
- 正本はMarkdown。認証情報は環境変数だけに置き、`.odin/` の実データをテストで変更しない。
- `npm test` は一時vault/モック、`npm run test:e2e` は専用vaultを使う。
- 変更後は関連テストと型チェック。UI変更はPC/スマホの実操作とスクリーンショットで確認する。
- Next.jsのコード変更前に `node_modules/next/dist/docs/` の該当ガイドを読む。
- 公開・デプロイ・ライセンス変更は所有者の明示指示が必要。
- 配布準備の状況と素材の確認事項は `docs/RELEASE-STATUS.md` と `docs/ASSET-REVIEW.md` を読む。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
