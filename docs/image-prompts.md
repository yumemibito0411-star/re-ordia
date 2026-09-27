# RE:ORDIA 画像制作ガイド（ChatGPT / Canva）

> 2026-09 時点：6枚の写真は Canva の画像生成で作成済み（Canva デザイン「RE:ORDIA Web Images」の2〜7ページ）。差し替える場合は同じファイル名で上書きしてください。`finale.jpg`／`ogp.jpg` は仮版です。

サイトは画像がなくても成立するよう、各画像枠に仮のグラデーションとファイル名ラベル（右上）を出しています。
下記の画像を作り、`images/` フォルダに **指定のファイル名** で置くと自動で差し替わります。

## アートディレクション

テーマは **「ご褒美ではなく、日常の儀式（Not a reward. A ritual.）」**。
いかにもエステのパンフレットのような「白いタオル＋笑顔」ではなく、ファッション誌の美容ページのような写真を目指します。

- **光**：夕方の窓辺の光、キャンドルのような暖色、強い影。フィルムカメラの粒子感
- **色**：アイボリー `#F6F0E8`／ブラッシュ `#ECD3C8`／シャンパンゴールド `#E6CFA3`／エスプレッソ `#221A16`
- **構図**：寄りのクロップ（肌・手・首すじ）、余白たっぷり、顔は写しすぎない
- **NG**：文字やロゴの写り込み、青白い照明、過度な肌のレタッチ、露出の多いボディ表現

## 画像一覧と置き場所

| ファイル名 | 使う場所 | 形 | 作るツール |
|---|---|---|---|
| `hero-portrait.jpg` | トップのアーチ型の写真 | 縦 3:4 | ChatGPT |
| `concept-1.jpg` | コンセプトのアーチ | 縦 3:4 | ChatGPT |
| `concept-2.jpg` | コンセプトの丸 | 正方形 | ChatGPT |
| `venue.jpg` | 開催概要の丸（月のイメージ） | 正方形 | ChatGPT |
| `facial.jpg` | メニューのフェイシャルパネル | 横 3:2 | ChatGPT |
| `body.jpg` | メニューのボディパネル | 横 3:2 | ChatGPT |
| `finale.jpg` | 最後の予約セクション背景 | 横 16:9 | Canva |
| `ogp.jpg` | SNSでシェアされた時の画像 | 1200×630 | Canva |

---

## ChatGPT で作る写真

ChatGPTにそのまま貼り付けてください（英語の方が安定します）。
**最初に「共通スタイル」を送ってから**各プロンプトを送ると、全体の統一感が出ます。

### 共通スタイル（最初に1回送る）

```
これから美容イベント「RE:ORDIA」のWebサイト用写真を数枚作ります。
全て以下のスタイルで統一してください：
Editorial beauty photography for a luxury magazine. Warm late-afternoon window light,
soft film grain, shallow depth of field. Colour palette strictly limited to ivory,
blush pink, champagne gold and deep espresso brown. Calm, intimate, quiet luxury.
No text, no logos, no watermarks.
```

### 1. `hero-portrait.jpg` — 縦 3:4

```
Close-up side profile of a Japanese woman in her 30s with eyes gently closed,
bare dewy skin, hair loosely tied back, a single ray of warm golden sunlight
falling across her cheek and neck, blush-toned background softly out of focus.
Serene, confident, not smiling. Portrait orientation 3:4.
```

### 2. `concept-1.jpg` — 縦 3:4

```
A woman's hand resting lightly on her collarbone, cream silk robe slipping off the
shoulder, warm light and soft shadows of window blinds across the skin,
ivory and blush tones. Intimate but elegant, face cropped out. Portrait 3:4.
```

### 3. `concept-2.jpg` — 正方形

```
Still life: a small brushed-gold tray holding two amber glass skincare bottles and
a folded ivory towel, on warm travertine stone, hard afternoon shadow,
a sprig of dried pampas grass. Top-down, minimal. Square 1:1.
```

### 4. `venue.jpg` — 正方形（丸く切り抜かれ「月」に見立てます）

```
Looking up at a glowing round paper lantern or dome light in a dark, luxurious
hotel interior, warm champagne glow fading into deep espresso-brown darkness,
the light source centred like a full moon. Square 1:1.
```

### 5. `facial.jpg` — 横 3:2

```
An aesthetician's fingertips gently pressing on a woman's cheekbone during a
facial treatment, extreme close-up, glossy skin with a light cream texture,
warm golden light, blush and ivory tones. Landscape 3:2.
```

### 6. `body.jpg` — 横 3:2

```
A therapist's hands performing a slow lymphatic massage along a woman's shoulder
blade, draped in an ivory towel, warm dim light, subtle sheen of oil on skin,
tasteful and non-revealing. Landscape 3:2.
```

> 生成画像は「イメージ」として使ってください。実在ホテルの写真を使う場合は、ホテルの使用許諾が必要です。

---

## Canva で作るもの

### 7. `finale.jpg`（最後の予約セクション背景）— 1920×1080

1. Canvaで「カスタムサイズ 1920×1080」を作成
2. 背景にグラデーション（中央 `#6D4D3A` → 外側 `#1B1411`）
3. ChatGPTで作った `hero-portrait.jpg` を全面に配置し、透明度 35% ＋「ぼかし」強め
4. 素材検索「gold foil texture」「light leak」を画面の端に薄く（透明度 20% 前後）重ねる
5. **文字は入れない**（サイト側で「See you at RE:ORDIA」を重ねるため）
6. JPG・画質80でダウンロード

### 8. `ogp.jpg`（SNSシェア用）— 1200×630

1. Canvaで「カスタムサイズ 1200×630」を作成
2. 背景 `#F6F0E8`、左上に `#ECD3C8`、右下に `#E6CFA3` のぼかした円を置く（サイトのトップと同じ雰囲気）
3. 大きく2行で配置
   - 1行目 `Re:define`（Cormorant Garamond Italic / `#221A16`、「:」だけ `#B08D57`）
   - 2行目 `Ordinary`（Cormorant Garamond / 文字は塗りなし・細い黒の縁取り）
4. 右側に `hero-portrait.jpg` をアーチ型フレームで配置
5. 右下に小さく `RE:ORDIA｜月に一度の美容イベント`

---

## アップ前に

- 横幅は最大2400px、1枚300KB前後に圧縮（[Squoosh](https://squoosh.app) など）
- ファイル名は上表のとおり半角小文字で
