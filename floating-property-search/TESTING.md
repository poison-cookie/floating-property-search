# Testing Checklist

社内テストでは、まず `ひがしこうち旅` を基準サイトとして確認します。

## 前提

- `floating-property-search.user.js` を有効にする。
- 候補表示も確認する場合は `mansion-autocomplete.user.js` も有効にする。
- 検証後に追加で開いたタブは閉じる。

## 1. 基本表示

対象URL:

- `https://higashi-kochi.jp/`

確認項目:

- ページ左下にフローティングフォームが表示される。
- 下部の旧検索ボタンは表示されない。
- 設定UIを開いて閉じるボタンで閉じられる。

## 2. フローティング検索

手順:

1. `https://higashi-kochi.jp/` を開く。
2. フローティングフォームに `温泉` と入力する。
3. Enter または検索ボタンで送信する。

期待結果:

- `https://higashi-kochi.jp/hotel/` に遷移する。
- 宿泊検索の keyword input に `温泉` が入る。
- URL に `keyword=%E6%B8%A9%E6%B3%89` が反映される。
- pending キーは消費後に残らない。

## 3. 設定UI

確認項目:

- `検索フォーカス設定を開く` で設定UIが開く。
- `フォーカステスト` で対象inputの診断が表示される。
- 保存時、現在ページで対象inputが見つからない場合は警告が表示される。
- 入力中に他タブで設定変更があっても、編集中フォームが勝手に再描画されない。

## 4. 既存オートコンプリート連携

前提:

- `mansion-autocomplete.user.js` が有効。

確認項目:

- フローティングフォームの input は通常DOM上に存在する。
- 候補ポップアップは `mansion-autocomplete` 側の UI として表示される。
- Floating Property Search 側の独自候補UIは表示されない。
- 候補確定後、もう一度 Enter で検索送信できる。

## 5. 複数タブ

手順:

1. ひがしこうちを2タブで開く。
2. それぞれ別の検索語句をフローティングフォームから送信する。

期待結果:

- 各タブに別々の `tabId` が発行される。
- pending キーは `floatingPropertySearch.pendingKeyword.v1.<tabId>` の形式になる。
- 別タブの検索語句で上書きされない。
- 他タブの設定変更は開いているタブへ同期される。

## 6. 回帰確認

確認項目:

- `node --check dist/floating-property-search.user.js` が通る。
- 関数コメント漏れがない。
- 検証用に増やしたタブを閉じる。
