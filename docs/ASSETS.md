# 公開版Odinの人物画像

2026-09-26。公開用の騎乗人物を、内蔵 `image_gen` で新たに生成しました。具体的なモデルバージョンはツールから確認できないため断定していません。

## デザイン

従来の角のある兜・棘状の鎧・大剣から、月蝕の環を持つフード、白銀の仮面と編んだ髭、星図の鎧、天球儀を思わせる槍、三日月の馬具へ変更しました。現在の騎乗構図と銀青の月光を参考にし、人物・馬具・武器を作り直しています。

- 配布ファイル: `public/assets/odin-refined-cutout.webp`。参照URLを維持して画像だけを置換。
- 1280 × 921、WebP、透過alpha。生成元PNGからSharpで寸法調整とエンコードだけを実施。
- 元の人物を合成していた `odin-reference-realm.webp` は、人物のない `odin-realm-unified.webp` と同じ背景に置換。`odin-realm.webp` も同じ人物なし背景へ統一。
- 非公開の個人版で使用する画像・アプリコード・本番環境は変更していません。公開版の同期元に専用素材を指定しており、再同期でも旧人物に戻りません。

## 入力の役割

1. 従来の騎乗人物: 配置・ポーズ・縮尺の参考。顔・兜・鎧・馬具・武器の造形を保持しないよう指定。
2. 人物のない月夜の背景: 色と光だけの参考。出力は背景のない透過人物。

## 最終プロンプト

```text
Use case: stylized-concept. Create a NEW ORIGINAL mounted Norse wisdom sovereign character for the public edition of a Japanese knowledge app called Odin. This is a substantial new character design, NOT a restoration of the reference character.
INPUT ROLES: image 1 is ONLY a placement/pose/scale reference for the mounted rider silhouette; do not preserve its face, helmet, armor, horse armor or weapon design. Image 2 is ONLY a moonlit environment color/lighting reference; no scenery in the output.
Art direction: extraordinary sacred yet ominous Nordic dark fantasy painted realism, charcoal, indigo, weathered platinum, tiny aged gold accents, moonlit blue rim illumination. The new sovereign wears a low circular broken-eclipse crown floating just behind a calm hooded head, an aged ivory-metal face mask with ONE small blue luminous eye slit, and flowing midnight robes over broad smooth overlapping armor plates engraved with fine constellation maps. No tall forked horns, no jagged spike suit. Regal slender human proportions. An elegant long braided silver beard emerges beneath the mask; heavy raven-feather mantle on shoulders, long indigo fabric trailing left. One hand holds the reins, the other carries a long slender straight ceremonial SPEAR angled gently down toward the right, with a small open astronomical ring and leaf-shaped platinum tip. No enormous curved sword. The horse is a powerful anatomically natural dark dapple-gray Nordic horse with four coherent planted legs, quiet alert ears, flowing wind-blown silver-black mane and tail. Distinctive restrained pale platinum crescent-shaped chamfron, smooth layered saddle armor, engraved bronze harness rings; no jagged horn-like horse armor. Four clearly separated natural legs, solid hooves. Mounted ruler faces right in a majestic still three-quarter side view, tail and cape streaming left. Keep the striking mounted-god premise but create a clearly distinct identity and silhouette from Final Fantasy XVI Odin or any existing game character. No logos, text, no added bird.
COMPOSITION for drop-in UI asset: horizontal canvas approximately 1280x921 (aspect 1.39); whole rider/horse/spear inside frame. Hooves almost at bottom, hoof cluster x0.23..0.68, rider head near x0.50,y0.10, horse muzzle near x0.88,y0.43, tail tip near x0.03,y0.75, spear tip near x0.97,y0.84. Fill canvas generously with minimal padding, keep all tips intact. Match image2 subtle silver-blue moonlight from above and behind with detailed navy shadow planes. Clean detailed cutout, true transparent alpha including hair and gaps between legs. NO painted background, black/white matte, ground, cliff, platform, cast-shadow plane, mist, aura, particles, checkerboard. All background pixels transparent. Polished highly dimensional finished game illustration.
```

## 接地の修正プロンプト

生成した新しい人物だけを参照し、4本の脚の姿勢を調整しました。最終配置では公開版専用CSSを追加し、岩の頂面に足が収まるように縮尺と位置を調整しています。私用版のCSSは変更していません。

```text
Refine this transparent mounted Norse wisdom sovereign asset. Preserve the NEW design exactly: hood, eclipse ring crown, silver beard and mask, star-chart armor and cape, long straight astronomical spear, gray horse head and crescent harness. Preserve the full 1478x1064 canvas composition and true transparent background. This is a precise anatomical grounding correction ONLY.
The character is composited onto a narrow flat rock whose support spans x=0.24 to x=0.67 at the bottom of this image. The current front hooves are too far right and float past the rock. Redraw the horse's lower torso and FOUR natural legs to create a compact, weight-bearing, three-quarter stance with all FOUR hoof contact points within x=0.26..0.66. Target hind hoof centers x=.29 and .39, front hoof centers x=.56 and .65. All hooves rest on the same nearly horizontal baseline at y=.98. Shift the horse torso slightly left if anatomically necessary; arrange its body angled toward the viewer in depth so the legs can stand close beneath it, not absurdly slanted. Keep the head facing right at the same height, similar tail/cape extent, and preserve rider position and weapon. Four legs only, four clean distinct hooves, no extra legs or ghost legs, no raised hoof. Keep the new character full size; do not add canvas padding or shrink everything.
Match the subtle moonlit blue shading, natural fine hair, premium painted dark fantasy finish. NO ground or rock added, no environment, no background, no shadow plane, no glow cloud, no letters. Keep actual alpha transparency in all negative spaces. Keep the same aspect ratio 1.39 and all weapon/cape tips within image.
```

## 配布前に確認すること

今回の造形変更は権利上の判断やライセンス付与を意味しません。以前のコミットには旧人物素材が残ります。公開前には必要に応じて履歴を含めた配布対象を整理し、コード・画像の配布条件を決めてください。リポジトリは引き続き非公開です。

## ワークフローのインフォグラフィック（2026-09-27）

`docs/images/readme-workflow.webp`。内蔵画像生成で新規制作し、WebPへ符号化。人物・ブランドロゴなどの参照画像は使用していません。図内のデバイス画面は説明用イラストです。

```text
Japanese infographic for Odin, landscape 3:2, midnight navy/black, blue/violet luminous lines, silver-white legible typography, original Norse ravens, castle and constellations. Clear three-step workflow: 01「AIに話す」「Odinに保存して」「知識・アイデア・やること」; 02「Odinが保存」with silver raven/archive and a two-way vertical link to cloud「自分のGoogle Drive」「Markdownで保管」; 03「あとで活用」with desktop/smartphone「検索・編集・タスク管理」. Header「会話から、使える記録へ。」brand「Odin」. Footer「いつものAI × 自分のDrive × Odin」「利用にはAI・Google Driveとの接続設定が必要です」. Clear arrows, readable at README width, generous whitespace. No third-party logos or franchise characters.
```
