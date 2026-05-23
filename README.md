# voxel-blockout

Three.js と TypeScript で作る BlockOut II 風の 3D ポリキューブパズルです。

現状は以下まで実装済みです。

- BlockOut II 標準の `5x5x12` ピット
- `FLAT` / `BASIC` / `EXTENDED` ブロックセット定義
- 41 種の BlockOut II ポリキューブ定義
- `Z` 奥行き方向への自動落下
- `x/y` 平面上の 8 方向移動
- 3 軸 6 方向回転
- 固定済みブロックとの衝突判定
- `x/y` 平面が全面埋まったときの `Z` プレーン消去
- BlockOut II 由来のスコア / レベル / 落下速度計算
- `Space` によるハードドロップ

## セットアップ

```bash
npm install
npm run dev
```

## 操作

- `ArrowLeft` / `ArrowRight`: 左右に移動
- `ArrowUp` / `ArrowDown`: 奥 / 手前に移動
- `7` / `9` / `1` / `3`: 斜め移動
- `Q` / `A`: X 軸回転
- `W` / `S`: Y 軸回転
- `E` / `D`: Z 軸回転
- `Space`: ハードドロップ
- `P` / `Escape`: ポーズ
- `R`: リスタート

`Space` / `P` / `Escape` / `R` はキーを押しっぱなしにしても連続入力しないようにしています。

## 現状の仕様メモ

- 消去判定は `Z` プレーン単位です。
- 回転時は BlockOut II の回転中心に近い補正を行います。
- スコアとレベルは `/home/mizuki2/dev/BlockOut` の係数を移植しています。
- 効果音は未実装です。
