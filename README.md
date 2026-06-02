# Boxel Tris

## ゲーム概要

- Three.js と TypeScript で作る 3D ポリキューブパズル
- 独自のポリキューブ形状と 3D ピット消去ルールを採用
- `6x6x9` のピットへブロックを奥行き方向に落として、埋まった一面の `Z` プレーンを消す
- 雪と氷のボクセル空間、ブランドロゴ、Depth パネル、NEXT / HOLD を備えたブラウザゲーム

## ゲームの仕様と挙動

- `x/y` 平面でブロックを動かし、`z` 軸の奥へ自動落下
- `Q/A`、`W/S`、`E/D` で 3 軸 6 方向回転
- `Shift` / `5` でソフトドロップ、`Space` でハードドロップ
- `C` / `H` で Hold、右側 UI に NEXT と HOLD を表示
- 着地点ゴースト、着地面フットプリント、Depth レイヤー表示を描画
- ブロックの形が複雑になるレベル分けとして `易しい` / `普通` / `難しい` を選択
- `2面同時消去タイム`、`5面消去タイム`、`2000点到達タイム`、`120ブロック落下タイム`、`落下ブロック全消し` のミッションを選択
- 一時停止中とゲームオーバー中はドラッグまたは矢印キーで視点確認

## 構成

- `src/main.ts` アプリ起動と `GameEngine` のマウント
- `src/GameEngine.ts` ゲームループ、入力、ポーズ、設定、HUD 同期
- `src/GameState.ts` ピット状態、衝突、回転、消去、スコア、ミッション
- `src/Renderer.ts` Three.js シーン、HUD、プレビュー、カメラ確認
- `src/constants/` ポリキューブ定義、スコア係数、フィールド定数
- `src/config/` 操作キーとプレイフィールド設定
- `src/styles.css` HUD とゲーム画面のスタイル
- `public/assets/` Vite から配信するロゴ、背景、3D モデル
- `raw-assets/` 変換前素材や候補素材の置き場

```text
Keyboard / Pointer
  -> GameEngine
  -> GameState
  -> Renderer
  -> Three.js canvas + DOM HUD
```

## 関連ドキュメント

- 実行、検証、ビルド用コマンドは `package.json` の `scripts` を参照
