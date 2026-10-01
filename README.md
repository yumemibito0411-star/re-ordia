# re-ordia — MASHUP PRINCE × PROJECT X

渋谷発エンタメコンテスト「MASHUP PRINCE」と非公開プログラム「PROJECT X」のランディングページ。
ビルド不要の静的サイトです。`index.html` をブラウザで開くか、任意の静的ホスティング（GitHub Pages / Netlify / Vercel など）にそのまま置けば動きます。

## 構成

```
index.html              ページ本体
assets/css/style.css    スタイル（紫×青ネオンのダークテーマ）
assets/js/main.js       インタラクション
assets/img/             画像素材（Canva で生成）
```

## セクション

1. HERO — 指先に人の粒が集まるキャンバス演出 + PEOPLE PULLED カウンター
2. THE RULE — 伏せ字（ホバーで「CLASSIFIED」）と賞金
3. PROJECT X — 仕掛け人 X の紹介
4. TRANSMISSION — X からのメッセージをタイピング表示
5. SCREENING — 3 問の資格診断クイズ
6. CLASSIFIED FILES — 面談で開示される情報
7. SHOWTIME — 1/23（JST）までのカウントダウン
8. YOUR MOVE — LINE 面談予約 CTA（`https://lin.ee/QwFa4eG`）

## 画像素材

| ファイル | 用途 |
| --- | --- |
| `stage.jpg` | HERO 背景 / OGP (`ogp.jpg`) |
| `city.jpg` | PROJECT X・最終 CTA 背景 |
| `fixer.jpg` | 仕掛け人 X のポートレート |
| `files.jpg` | CLASSIFIED FILES 背景 |

差し替える場合は同じファイル名で上書きしてください。

## ローカル確認

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## 社内チャット（`chat/`）

Slack ライクな社内向けリアルタイムチャットを `chat/` に同梱しています。
Node.js サーバーが必要なため GitHub Pages では動きません。起動方法は [`chat/README.md`](chat/README.md) を参照してください。
