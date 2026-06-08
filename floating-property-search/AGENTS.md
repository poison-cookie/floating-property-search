# AGENTS

このプロジェクトは Tampermonkey / Violentmonkey 用ユーザースクリプトです。

- 初期版では検索実行を自動化しない
- ユーザー操作 1 回につき、検索欄へのフォーカスまたは検索ページへの移動だけを行う
- 保存キーは `floatingPropertySearch.*` に統一する
- 既存の `mansionAutocomplete.*` キーは使用しない
- サイト側 DOM へ影響する CSS やグローバル DOM は増やさない
- 外部ライブラリは使わない
