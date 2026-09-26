# RE:ORDIA 画像制作ガイド（ChatGPT / Canva）

サイトは画像がなくても表示できるよう、各画像枠に仮のグラデーション＋ファイル名ラベルを表示しています。
下記の画像を作成し、`images/` フォルダに **指定のファイル名** で置くと自動で差し替わります。

## 共通トーン（全画像に適用）

- カラー：エスプレッソブラウン `#2A201C`／アンティークゴールド `#B08D57`／クリーム `#F8F4EE`／くすみローズ `#C99A86`
- 雰囲気：ラグジュアリーホテル、静けさ、上品、温かい間接照明、低彩度、フィルム調
- NG：派手な色、白飛び、ロゴや文字の写り込み、過度な肌の加工

---

## ChatGPT（画像生成）で作る写真

ChatGPTにそのまま貼り付けてください。日本語でも通じますが、英語の方が安定します。

### 1. `hero.jpg`（ファーストビュー背景）— 横長 3:2 / 2400×1600px 以上

```
A luxurious, calm hotel spa treatment room at dusk, warm indirect golden lighting,
dark espresso-brown wood walls, cream linen on a treatment bed, a small brass tray
with skincare bottles, soft bokeh, cinematic, editorial beauty photography,
muted low-saturation palette of espresso brown, antique gold and cream,
lots of negative space in the center for text overlay, no people, no text, no logos.
Aspect ratio 3:2, photorealistic.
```

### 2. `concept.jpg`（コンセプト）— 縦長 4:5 / 1200×1500px 以上

```
Close-up portrait of a Japanese woman in her 30s with eyes closed, receiving a gentle
facial treatment, natural healthy skin, serene expression, warm golden side light,
dark brown background, cream towel, elegant and quiet mood, editorial beauty
photography, muted espresso-brown / antique-gold / cream color palette,
no text, no logos. Aspect ratio 4:5, photorealistic.
```

### 3. `facial.jpg`（フェイシャルメニュー）— 横長 16:10 / 1600×1000px 以上

```
Aesthetician's hands applying cream to a woman's cheek during a luxury facial
treatment, top-down angle, soft warm lighting, cream towel, gold-toned skincare
jars nearby, dark espresso-brown surroundings, calm and premium mood, shallow depth
of field, muted brown/gold/cream palette, no text, no logos. Aspect ratio 16:10.
```

### 4. `body.jpg`（ボディメニュー）— 横長 16:10 / 1600×1000px 以上

```
Luxury body treatment scene: a therapist's hands performing a lymphatic massage on a
woman's back and shoulders, draped with a cream towel, warm dim golden lighting,
dark brown wooden interior, polished and tasteful, not revealing, editorial spa
photography, muted brown/gold/cream palette, no text, no logos. Aspect ratio 16:10.
```

### 5. `venue.jpg`（開催概要）— 縦長 4:5 / 1200×1500px 以上

```
Elegant Japanese luxury hotel lobby or banquet corridor with warm chandelier light,
carpet and wood panelling in espresso brown and antique gold, a vase of white flowers,
calm and upscale atmosphere, architectural interior photography, low saturation,
no people, no text, no logos. Aspect ratio 4:5, photorealistic.
```

> ※ 実在ホテル（グランドプリンスホテル新高輪）の写真を使う場合は、ホテル側の使用許諾を得たものを使用してください。生成画像は「イメージ」として扱い、実物と誤認させない表現にしてください。

---

## Canva で作るもの

### 6. `cta-bg.jpg`（予約セクション背景）— 2400×1200px

1. Canvaで「カスタムサイズ 2400×1200」を作成
2. 背景色 `#2A201C` を敷き、ChatGPTで作った `hero.jpg` または `concept.jpg` を配置して透明度 40% 程度に
3. 「ゴールド 箔 テクスチャ」系の素材を左下・右上に薄く（透明度 20〜30%）重ねる
4. **文字は入れない**（サイト側でテキストを重ねるため）
5. JPG・画質80でダウンロード

### 7. `ogp.jpg`（SNSシェア用画像）— 1200×630px

1. Canvaで「カスタムサイズ 1200×630」を作成
2. 背景色 `#2A201C`
3. 中央に ダイヤモンドのアイコン（色 `#B08D57`）
4. その下に `RE:ORDIA`（フォント例：Cormorant Garamond / 色 `#F8F4EE` / 字間広め）
5. サブコピー `Redefine Ordinary — 日常を再定義する美容イベント`（フォント例：しっぽり明朝 / 色 `#C99A86`）
6. 下部に細いゴールドのライン
   ※ 資料1ページ目の表紙をそのまま横長にしたイメージです

### 8. （任意）ロゴデータ

サイトのダイヤモンドアイコンはSVGで仮作成しています。正式なロゴデータがCanvaにある場合は
SVGまたは透過PNGで書き出して共有いただければ差し替えます。

---

## 画像の最適化（アップ前に推奨）

- 横幅2400px以下、1枚あたり300KB前後を目安に圧縮（[Squoosh](https://squoosh.app) など）
- ファイル名は上記のとおり半角小文字で
