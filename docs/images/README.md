# README用の画像

2026-09-26に公開準備版の実画面を撮影しました。

- readme-home.webp: PCのホーム（1440 × 1000）。
- readme-graph.webp: 36件のサンプル記録を3つのプロジェクトでたどる星図（1440 × 1000）。
- readme-memory.webp: 架空の旅ノートを表示した詳細画面。ダイアログだけをブラウザーで撮影。
- readme-mobile-home.webp / readme-mobile-tasks.webp: スマートフォン幅のホームとタスク（390 × 844）。

記録は「週末の旅」「小さなアプリをつくる」「読書と思考のノート」の架空データです。アプリの保存処理を通して作成し、実際にホーム→星図→記録の詳細、スマホのタスク画面を操作して撮影しました。個人の記憶・会話ログ・認証情報・本番URLは含みません。初回起動時のサンプル内容とは異なります。

撮影後の加工はWebPエンコードのみです。UIを生成画像で描き直したものではありません。世界観の背景・人物・ロゴにはアプリの生成素材を使用しています。一般のテスト用スクリーンショットは引き続きGit管理対象外とし、ここに選定した紹介用画像だけを収録します。

## ワークフローのインフォグラフィック

`readme-workflow.webp` は2026-09-27に画像生成で制作した説明図です。AI→Odin→活用の流れと、OdinがGoogle Driveを読み書きする関係を表しています。図内のPC・スマホ画面は説明用イラストで、実UIのスクリーンショットではありません。生成プロンプトは [ASSETS.md](../ASSETS.md) に記録しています。

英語版は `readme-workflow-en.webp`。承認済み日本語図の構図を保持して画像生成で英語化し、文字の可読性と内容を目視確認しました。実画面写真は日本語表示です。

## English screenshots (2026-09-27)

The English README uses actual English UI captures with 27 fictional records across three projects: a weekend by the sea, dinner with friends, and a reading corner. Notes, tasks, tags, and shopping lists are in English. These samples were created through Odin's normal record functions in an isolated local vault; no private records or live Drive account were used.

- `readme-home-en.webp` / `readme-graph-en.webp`: desktop, captured at a 1440 × 1000 viewport (image output 1432 × 994).
- `readme-memory-en.webp`: the conversation note dialog, cropped from a desktop screenshot to 670 × 701.
- `readme-mobile-home-en.webp` / `readme-mobile-tasks-en.webp`: 390 × 844 viewport (image output 382 × 827).
- `readme-mobile-shopping-en.webp`: shopping checklist, 390 × 844.

Language switching and persistence, map-to-note navigation, task completion and undo, and shopping checkbox persistence after reload were checked in the browser. Only crop and WebP encoding were applied; no generated replacement UI or text was used.
