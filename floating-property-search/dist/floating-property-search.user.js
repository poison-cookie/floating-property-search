// ==UserScript==
// @name         Floating Property Search
// @namespace    https://local/floating-property-search
// @version      0.8.5
// @description  Focus, fill, or submit a configured property search field from anywhere on the same site.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  if (document.getElementById('floating-property-search-ui-host')) return;

  const STORAGE_PREFIX = 'floatingPropertySearch';
  const CUSTOM_CONFIGS_KEY = `${STORAGE_PREFIX}.siteConfigs.v1`;
  const DISABLED_SITES_KEY = `${STORAGE_PREFIX}.disabledSites.v1`;
  const PENDING_FOCUS_KEY = `${STORAGE_PREFIX}.pendingFocus.v1`;
  const PENDING_KEYWORD_KEY = `${STORAGE_PREFIX}.pendingKeyword.v1`;
  const PENDING_INDEX_KEY = `${STORAGE_PREFIX}.pendingIndex.v1`;
  const SHORTCUTS_KEY = `${STORAGE_PREFIX}.shortcuts.v1`;
  const MODE_KEY = `${STORAGE_PREFIX}.mode.v1`;
  const MANAGER_BUTTON_POSITION_KEY = `${STORAGE_PREFIX}.managerButtonPosition.v1`;
  const TAB_ID_KEY = `${STORAGE_PREFIX}.tabId.v1`;
  const STORAGE_SYNC_KEYS = [
    CUSTOM_CONFIGS_KEY,
    DISABLED_SITES_KEY,
    SHORTCUTS_KEY,
    MODE_KEY,
    MANAGER_BUTTON_POSITION_KEY,
  ];
  const PENDING_FOCUS_TTL_MS = 10 * 60 * 1000;
  const PENDING_KEYWORD_TTL_MS = 10 * 60 * 1000;
  const FOCUS_RETRY_COUNT = 24;
  const FOCUS_RETRY_INTERVAL_MS = 150;
  const TAB_ID = getTabId();

  const bundledSiteConfigs = [
    {
      id: 'higashi-kochi-hotel',
      name: 'ひがしこうち旅 宿泊',
      host: 'higashi-kochi.jp',
      enabled: true,
      searchPageUrl: 'https://higashi-kochi.jp/hotel/',
      inputName: 'keyword',
      keywordSelector: '#searchConts input[name="keyword"]',
      submitMode: 'button',
      submitSelector: 'input[name="btnSearch"]',
      readonly: true,
    },
    {
      id: 'yahoo-japan-search',
      name: 'Yahoo! JAPAN',
      host: 'www.yahoo.co.jp',
      enabled: true,
      searchPageUrl: 'https://www.yahoo.co.jp/',
      inputName: 'p',
      keywordSelector: 'input[name="p"]',
      submitMode: 'button',
      submitSelector: 'button[type="submit"]',
      readonly: true,
    },
    {
      id: 'musegirls-image-search',
      name: 'MuseGirls 画像検索',
      host: 'musegirls.club',
      enabled: true,
      searchPageUrl: 'https://musegirls.club/search/images/',
      inputName: '',
      keywordSelector: '#actress',
      submitMode: 'none',
      submitSelector: '',
      suggestionSelectors: ['a.js-actress-filter'],
      readonly: true,
    },
  ];

  let customSiteConfigs = loadCustomSiteConfigs();
  let disabledSites = loadDisabledSites();
  let shortcutsEnabled = readValue(SHORTCUTS_KEY, { enabled: true }).enabled !== false;
  let operationMode = normalizeMode(readValue(MODE_KEY, { mode: 'focus' }).mode);
  let managerButtonPosition = loadManagerButtonPosition();
  let managerButtonDrag = null;
  let lastFocusedInputName = '';
  let currentConfig = findCurrentConfig();
  let managerEditingConfigId = currentConfig?.id || '';
  let managerFlashMessage = null;
  let managerHasUnsavedChanges = false;

  const uiHost = document.createElement('div');
  uiHost.id = 'floating-property-search-ui-host';
  const uiRoot = uiHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    button, input, textarea, select {
      font: inherit;
    }
    #fps-manager-button {
      display: none;
    }
    #fps-floating-form {
      position: fixed;
      left: 14px;
      bottom: 14px;
      z-index: 2147483000;
      display: grid;
      grid-template-columns: minmax(150px, 220px) auto;
      gap: 4px;
      align-items: center;
      padding: 6px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
    }
    #fps-floating-form[hidden] {
      display: none;
    }
    #fps-floating-form .fps-floating-input {
      width: 100%;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      padding: 5px 7px;
      background: #fff;
      color: #111827;
      font-size: 12px;
    }
    #fps-floating-form .fps-floating-input:focus {
      outline: 2px solid #93c5fd;
      outline-offset: 1px;
      border-color: #2563eb;
    }
    #fps-floating-form .fps-floating-button {
      height: 30px;
      border: 1px solid #111827;
      border-radius: 5px;
      padding: 0 9px;
      background: #111827;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #fps-floating-form #fps-floating-suggestions {
      grid-column: 1 / -1;
      max-height: 180px;
      overflow: auto;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      background: #fff;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
    }
    #fps-floating-form #fps-floating-suggestions[hidden] {
      display: none;
    }
    #fps-floating-form .fps-suggestion {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      width: 100%;
      min-height: 28px;
      align-items: center;
      border: 0;
      border-bottom: 1px solid #f3f4f6;
      padding: 5px 7px;
      background: #fff;
      color: #111827;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    #fps-floating-form .fps-suggestion:last-child {
      border-bottom: 0;
    }
    #fps-floating-form .fps-suggestion[data-active="true"],
    #fps-floating-form .fps-suggestion:hover {
      background: #eff6ff;
    }
    #fps-floating-form .fps-suggestion-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #fps-floating-form .fps-suggestion-meta {
      color: #6b7280;
      font-size: 11px;
      white-space: nowrap;
    }
    #fps-floating-form .fps-floating-note {
      display: none;
    }
    #fps-manager {
      position: fixed;
      inset: 0;
      z-index: 2147483001;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.28);
      color: #111827;
      font-size: 14px;
      line-height: 1.45;
    }
    #fps-manager[hidden] {
      display: none;
    }
    .fps-panel {
      width: min(820px, 100%);
      max-height: min(760px, calc(100vh - 36px));
      overflow: auto;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
    }
    .fps-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid #e5e7eb;
      background: #fff;
    }
    .fps-title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    .fps-subtitle {
      margin: 4px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .fps-body {
      display: grid;
      gap: 16px;
      padding: 18px;
    }
    .fps-section {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }
    .fps-section h3 {
      margin: 0 0 12px;
      font-size: 15px;
      line-height: 1.3;
    }
    .fps-manual-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-left: 18px;
      color: #374151;
      font-size: 13px;
    }
    .fps-manual-list strong {
      color: #111827;
    }
    .fps-manual-grid {
      display: grid;
      gap: 10px;
    }
    .fps-grid {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 10px 12px;
      align-items: center;
    }
    .fps-label {
      color: #374151;
      font-size: 13px;
      font-weight: 600;
    }
    .fps-input,
    .fps-select,
    .fps-textarea {
      width: 100%;
      min-height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 7px 9px;
      background: #fff;
      color: #111827;
    }
    .fps-textarea {
      min-height: 110px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .fps-input:focus,
    .fps-select:focus,
    .fps-textarea:focus {
      outline: 2px solid #93c5fd;
      outline-offset: 1px;
      border-color: #2563eb;
    }
    .fps-check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
    }
    .fps-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .fps-button {
      min-height: 34px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 7px 12px;
      background: #fff;
      color: #111827;
      cursor: pointer;
    }
    .fps-button:hover {
      background: #f9fafb;
    }
    .fps-button-primary {
      border-color: #111827;
      background: #111827;
      color: #fff;
    }
    .fps-button-primary:hover {
      background: #1f2937;
    }
    .fps-button-danger {
      border-color: #fecaca;
      color: #b91c1c;
    }
    .fps-note {
      margin: 8px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .fps-status {
      min-height: 20px;
      white-space: pre-line;
      color: #2563eb;
      font-size: 12px;
    }
    .fps-status[data-kind="error"] {
      color: #b91c1c;
    }
    .fps-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .fps-table th,
    .fps-table td {
      border-bottom: 1px solid #e5e7eb;
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }
    .fps-table th {
      color: #374151;
      font-weight: 700;
    }
    .fps-code {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
      #fps-manager {
        padding: 8px;
      }
      .fps-panel {
        max-height: calc(100vh - 16px);
      }
      .fps-head {
        padding: 12px;
      }
      .fps-body {
        padding: 12px;
      }
      .fps-grid {
        grid-template-columns: 1fr;
      }
      .fps-label {
        margin-top: 4px;
      }
    }
  `;

  const floatingStyle = document.createElement('style');
  floatingStyle.textContent = `
    #fps-floating-form {
      position: fixed;
      left: 14px;
      bottom: 14px;
      z-index: 2147483000;
      display: grid;
      grid-template-columns: minmax(150px, 220px) auto;
      gap: 4px;
      align-items: center;
      padding: 6px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
      box-sizing: border-box;
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #fps-floating-form[hidden] {
      display: none;
    }
    #fps-floating-form *,
    #fps-floating-form *::before,
    #fps-floating-form *::after {
      box-sizing: border-box;
    }
    #fps-floating-form .fps-floating-input {
      width: 100%;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      padding: 5px 7px;
      background: #fff;
      color: #111827;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #fps-floating-form .fps-floating-input:focus {
      outline: 2px solid #93c5fd;
      outline-offset: 1px;
      border-color: #2563eb;
    }
    #fps-floating-form .fps-floating-button {
      height: 30px;
      border: 1px solid #111827;
      border-radius: 5px;
      padding: 0 9px;
      background: #111827;
      color: #fff;
      font: 700 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    #fps-floating-form .fps-floating-note {
      display: none;
    }
  `;

  const managerButton = document.createElement('button');
  managerButton.id = 'fps-manager-button';
  managerButton.type = 'button';
  managerButton.textContent = '検 索';
  managerButton.title = '検索フォーカス設定';

  const floatingForm = document.createElement('form');
  floatingForm.id = 'fps-floating-form';
  floatingForm.hidden = true;

  const floatingInput = document.createElement('input');
  floatingInput.type = 'search';
  floatingInput.className = 'fps-floating-input';
  floatingInput.placeholder = '検索語句';
  floatingInput.autocomplete = 'off';

  const floatingSubmit = document.createElement('button');
  floatingSubmit.type = 'submit';
  floatingSubmit.className = 'fps-floating-button';
  floatingSubmit.textContent = '検索';

  const floatingNote = document.createElement('div');
  floatingNote.className = 'fps-floating-note';

  const floatingSuggestions = document.createElement('div');
  floatingSuggestions.id = 'fps-floating-suggestions';
  floatingSuggestions.hidden = true;

  floatingForm.append(floatingInput, floatingSubmit, floatingNote);

  const manager = document.createElement('div');
  manager.id = 'fps-manager';
  manager.hidden = true;

  uiRoot.append(style, managerButton, manager);
  document.documentElement.append(floatingStyle, floatingForm, uiHost);

  applyManagerButtonPosition();
  updateManagerButtonState();
  updateFloatingFormState();
  registerMenuCommands();
  registerStorageSync();
  cleanupExpiredPendingRequests();

  managerButton.addEventListener('pointerdown', startManagerButtonDrag);
  managerButton.addEventListener('click', (event) => {
    if (managerButtonDrag?.moved) return;
    event.preventDefault();
    openManager();
  });

  floatingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitFloatingSearch();
  });
  floatingInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') floatingInput.blur();
  });
  manager.addEventListener('mousedown', closeManager);
  document.addEventListener('focusin', handleDocumentFocusIn, true);
  window.addEventListener('resize', () => {
    if (!managerButtonPosition) return;
    managerButtonPosition = clampButtonPosition(managerButtonPosition.left, managerButtonPosition.bottom);
    applyManagerButtonPosition();
    writeValue(MANAGER_BUTTON_POSITION_KEY, managerButtonPosition);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!manager.hidden) closeManager();
    if (!floatingForm.hidden) hideFloatingSuggestions();
  });

  if (currentConfig && !isConfigDisabled(currentConfig)) {
    maybeApplyPendingKeyword(currentConfig);
    maybeFocusFromPending(currentConfig);
  }

  if (shortcutsEnabled) {
    document.addEventListener('keydown', (event) => {
      if (!isFocusShortcut(event)) return;
      if (!currentConfig || isConfigDisabled(currentConfig)) return;
      event.preventDefault();
      event.stopPropagation();
      if (operationMode === 'floating') {
        openFloatingForm();
        return;
      }
      focusSearchBoxOrOpenSearchPage(currentConfig);
    }, true);
  }

  // Tampermonkey / Violentmonkey のメニューコマンドを登録する。
  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('検索フォーカス設定を開く', openManager);
    GM_registerMenuCommand('検索フォームへフォーカス', () => {
      if (!currentConfig || isConfigDisabled(currentConfig)) {
        openManager();
        return;
      }
      focusSearchBoxOrOpenSearchPage(currentConfig);
    });
    GM_registerMenuCommand('このサイトで有効/無効を切り替え', () => {
      const config = currentConfig || createDraftConfigFromPage();
      setConfigDisabled(config.id, !isConfigDisabled(config));
      reloadState();
      updateManagerButtonState();
      updateFloatingFormState();
    });
    GM_registerMenuCommand('Ctrl + / を有効/無効にする', () => {
      shortcutsEnabled = !shortcutsEnabled;
      writeValue(SHORTCUTS_KEY, { enabled: shortcutsEnabled });
      window.alert(`Ctrl + /: ${shortcutsEnabled ? '有効' : '無効'}`);
    });
  }

  // 他タブで保存された設定変更を現在タブへ反映する。
  function registerStorageSync() {
    if (typeof GM_addValueChangeListener === 'function') {
      STORAGE_SYNC_KEYS.forEach((key) => {
        GM_addValueChangeListener(key, (_key, _oldValue, _newValue, remote) => {
          if (remote === false) return;
          refreshFromStorage();
        });
      });
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== null && !STORAGE_SYNC_KEYS.includes(event.key)) return;
      refreshFromStorage();
    });
  }

  // 保存領域から状態を読み直し、表示中UIへ反映する。
  function refreshFromStorage() {
    reloadState();
    managerButtonPosition = loadManagerButtonPosition();
    applyManagerButtonPosition();
    updateManagerButtonState();
    updateFloatingFormState();
    if (manager.hidden) return;
    if (managerHasUnsavedChanges) {
      showManagerSyncNotice('他タブで設定が変更されました。入力中の内容は保持しています。保存時に最新版へマージします。');
      return;
    }
    renderManager();
  }

  // 設定モーダルを開き、表示前に状態を最新化する。
  function openManager() {
    reloadState();
    updateFloatingFormState();
    hideFloatingSuggestions();
    if (typeof floatingInput.blur === 'function') floatingInput.blur();
    renderManager();
    manager.hidden = false;
  }

  // 設定モーダルを閉じる。背景クリック時は背景だけを閉じる対象にする。
  function closeManager(event) {
    if (event && event.target !== manager) return;
    manager.hidden = true;
    managerHasUnsavedChanges = false;
  }

  // 設定フォームに未保存変更があることを記録する。
  function markManagerDirty() {
    managerHasUnsavedChanges = true;
  }

  // 設定UIを再描画せず、他タブ同期の通知だけを表示する。
  function showManagerSyncNotice(message) {
    const panel = manager.querySelector('.fps-panel');
    if (!panel) return;
    let notice = panel.querySelector('.fps-sync-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'fps-status fps-sync-notice';
      const body = panel.querySelector('.fps-body');
      if (body) {
        body.prepend(notice);
      } else {
        panel.appendChild(notice);
      }
    }
    setStatus(notice, message, 'error');
  }

  // 設定モーダル全体のDOMを再描画する。
  function renderManager() {
    managerHasUnsavedChanges = false;
    manager.textContent = '';

    const panel = document.createElement('div');
    panel.className = 'fps-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());
    panel.addEventListener('focusin', hideFloatingSuggestions);

    const head = document.createElement('div');
    head.className = 'fps-head';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'fps-title';
    title.textContent = '検索フォーカス設定';
    const subtitle = document.createElement('p');
    subtitle.className = 'fps-subtitle';
    subtitle.textContent = currentConfig
      ? `現在の対象: ${currentConfig.name} (${currentConfig.host})`
      : `未設定サイト: ${window.location.hostname}`;
    titleWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'fps-button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', () => closeManager());

    head.append(titleWrap, closeButton);

    const body = document.createElement('div');
    body.className = 'fps-body';
    body.append(
      createManualSection(),
      createSiteRegistrationSection(),
      createBehaviorSection(),
      createConfigListSection(),
      createMigrationSection()
    );

    panel.append(head, body);
    manager.appendChild(panel);
  }

  // 設定画面内に機能マニュアルを表示する。
  function createManualSection() {
    const section = createSection('マニュアル');
    const wrap = document.createElement('div');
    wrap.className = 'fps-manual-grid';

    const overview = document.createElement('ul');
    overview.className = 'fps-manual-list';
    [
      ['基本', 'サイトごとに検索ページURLと対象inputを登録し、画面左下のフローティングフォームから検索します。'],
      ['検索', '検索語句を入力して Enter または検索ボタンを押すと、検索ページへ移動して対象inputへ値を反映します。'],
      ['候補', '候補表示は mansion-autocomplete.user.js をそのまま利用します。このスクリプト側では候補を独自生成しません。'],
      ['ショートカット', 'Ctrl + / は、フォーカスモードでは対象フォームへ移動し、フローティングモードでは小フォームへフォーカスします。'],
      ['複数タブ', '検索待ち状態はタブごとに分離されるため、別タブの検索語句で上書きされにくくなっています。'],
      ['基準テスト', '社内テストでは、まず https://higashi-kochi.jp/ から宿泊検索への遷移を確認してください。'],
    ].forEach(([label, text]) => {
      const item = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      item.append(strong, text);
      overview.appendChild(item);
    });

    const note = document.createElement('p');
    note.className = 'fps-note';
    note.textContent = '設定を変更したら「フォーカステスト」で対象inputが取れるか確認してください。候補が出ない場合は mansion-autocomplete.user.js が有効か確認し、必要に応じてページを再読み込みしてください。';

    wrap.append(overview, note);
    section.appendChild(wrap);
    return section;
  }

  // 現在サイトまたは選択中サイトの登録・編集フォームを作る。
  function createSiteRegistrationSection() {
    const config = getManagerFormConfig();
    const section = createSection('サイト登録・編集');
    section.addEventListener('input', markManagerDirty);
    section.addEventListener('change', markManagerDirty);
    const grid = document.createElement('div');
    grid.className = 'fps-grid';

    const nameInput = createInput(config.name || window.location.hostname);
    const hostInput = createInput(config.host || window.location.hostname);
    const urlInput = createInput(config.searchPageUrl || window.location.href);
    const inputNameInput = createInput(config.inputName || getInputNameFromSelector(config.keywordSelector) || 'keyword');
    const selectorInput = createInput(config.keywordSelector || buildInputNameSelector(inputNameInput.value));
    const submitModeSelect = document.createElement('select');
    submitModeSelect.className = 'fps-select';
    [
      ['none', '検索実行しない'],
      ['enter', 'Enterで検索実行'],
      ['button', '指定ボタンをクリック'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      submitModeSelect.appendChild(option);
    });
    submitModeSelect.value = normalizeSubmitMode(config.submitMode);
    const submitSelectorInput = createInput(config.submitSelector || '');
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = !isConfigDisabled(config) && config.enabled !== false;

    inputNameInput.addEventListener('input', () => {
      selectorInput.value = buildInputNameSelector(inputNameInput.value);
    });

    appendField(grid, '表示名', nameInput);
    appendField(grid, '対象ホスト', hostInput);
    appendField(grid, '検索ページURL', urlInput);
    appendField(grid, '対象input name', inputNameInput);
    appendField(grid, 'CSSセレクタ', selectorInput);
    appendField(grid, '検索実行', submitModeSelect);
    appendField(grid, '検索ボタンCSS', submitSelectorInput);
    appendField(grid, 'このサイトで有効', wrapCheckbox(enabledInput, 'ショートカットとフォーカスを有効にする'));

    const status = document.createElement('div');
    status.className = 'fps-status';
    if (managerFlashMessage) {
      setStatus(status, managerFlashMessage.message, managerFlashMessage.kind);
      managerFlashMessage = null;
    }

    const actions = document.createElement('div');
    actions.className = 'fps-actions';

    const saveButton = createButton(config.custom ? '設定を更新' : 'カスタム設定として保存', 'fps-button-primary', () => {
      const result = saveConfigFromForm({
        baseConfig: config,
        name: nameInput.value,
        host: hostInput.value,
        searchPageUrl: urlInput.value,
        inputName: inputNameInput.value,
        keywordSelector: selectorInput.value,
        submitMode: submitModeSelect.value,
        submitSelector: submitSelectorInput.value,
        enabled: enabledInput.checked,
      });
      if (!result.ok) {
        setStatus(status, result.message, 'error');
        return;
      }
      managerHasUnsavedChanges = false;
      managerEditingConfigId = result.config.id;
      reloadState();
      updateManagerButtonState();
      updateFloatingFormState();
      managerFlashMessage = {
        message: result.message,
        kind: result.warning ? 'error' : 'info',
      };
      renderManager();
    });

    const detectButton = createButton('直前のinput nameを取得', '', () => {
      const name = detectFocusedInputName();
      if (!name) {
        setStatus(status, 'ページ側で対象inputをクリックしてから実行してください。', 'error');
        return;
      }
      inputNameInput.value = name;
      selectorInput.value = buildInputNameSelector(name);
      setStatus(status, `input name="${name}" を取得しました。`, 'info');
    });

    const testButton = createButton('フォーカステスト', '', () => {
      const tempConfig = normalizeConfig({
        ...config,
        host: hostInput.value,
        searchPageUrl: urlInput.value,
        inputName: inputNameInput.value,
        keywordSelector: selectorInput.value,
        submitMode: submitModeSelect.value,
        submitSelector: submitSelectorInput.value,
      });
      if (!tempConfig) {
        setStatus(status, '設定内容が不正です。', 'error');
        return;
      }
      const diagnostics = diagnoseConfigOnCurrentPage(tempConfig);
      setStatus(status, formatDiagnostics(diagnostics), diagnostics.ok ? 'info' : 'error');
      if (diagnostics.canFocus) {
        const input = findSearchInput(tempConfig);
        if (input) focusInput(input);
      }
    });

    const currentPageButton = createButton('現在ページをフォームに反映', '', () => {
      const draft = createDraftConfigFromPage();
      managerEditingConfigId = '';
      nameInput.value = draft.name;
      hostInput.value = draft.host;
      urlInput.value = draft.searchPageUrl;
      inputNameInput.value = draft.inputName;
      selectorInput.value = draft.keywordSelector;
      submitModeSelect.value = normalizeSubmitMode(draft.submitMode);
      submitSelectorInput.value = draft.submitSelector;
      enabledInput.checked = true;
      setStatus(status, '現在ページの情報をフォームに反映しました。', 'info');
    });

    const newButton = createButton('新規登録に切替', '', () => {
      managerEditingConfigId = '';
      renderManager();
    });

    const deleteButton = createButton('このカスタム設定を削除', 'fps-button-danger', () => {
      if (!config.custom) {
        setStatus(status, '組み込み設定は削除できません。無効化はできます。', 'error');
        return;
      }
      if (!window.confirm(`${config.name} の設定を削除しますか？`)) return;
      customSiteConfigs = loadCustomSiteConfigs().filter((item) => item.id !== config.id);
      writeValue(CUSTOM_CONFIGS_KEY, customSiteConfigs);
      managerEditingConfigId = '';
      reloadState();
      updateManagerButtonState();
      updateFloatingFormState();
      renderManager();
    });

    actions.append(saveButton, currentPageButton, newButton, detectButton, testButton, deleteButton);

    const note = document.createElement('p');
    note.className = 'fps-note';
    note.textContent = '登録した設定はブラウザのユーザースクリプト保存領域に保存されます。対象ホストは example.com のように入力してください。サブドメインも同じ設定として扱います。';

    section.append(grid, actions, status, note);
    return section;
  }

  // 動作モードやショートカットなどの全体設定UIを作る。
  function createBehaviorSection() {
    const section = createSection('動作');
    const grid = document.createElement('div');
    grid.className = 'fps-grid';

    const modeSelect = document.createElement('select');
    modeSelect.className = 'fps-select';
    [
      ['focus', '指定フォームへフォーカス'],
      ['floating', 'フローティングフォームを使う'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = operationMode;
    modeSelect.addEventListener('change', () => {
      operationMode = normalizeMode(modeSelect.value);
      writeValue(MODE_KEY, { mode: operationMode });
      updateFloatingFormState();
    });

    appendField(grid, '動作モード', modeSelect);

    const shortcutInput = document.createElement('input');
    shortcutInput.type = 'checkbox';
    shortcutInput.checked = shortcutsEnabled;
    shortcutInput.addEventListener('change', () => {
      shortcutsEnabled = shortcutInput.checked;
      writeValue(SHORTCUTS_KEY, { enabled: shortcutsEnabled });
      updateManagerButtonState();
    });

    appendField(grid, 'Ctrl + /', wrapCheckbox(shortcutInput, 'フォーカスモードでは指定フォームへ移動、フローティングモードでは小フォームへフォーカスする'));

    const resetButton = createButton('左下ボタン位置をリセット', '', () => {
      managerButtonPosition = null;
      deleteValue(MANAGER_BUTTON_POSITION_KEY);
      applyManagerButtonPosition();
    });
    appendField(grid, '表示位置', resetButton);

    const note = document.createElement('p');
    note.className = 'fps-note';
    note.textContent = 'フローティングフォームは、入力語句を検索ページへ渡して指定inputにセットします。検索ボタンの自動クリックは行いません。';

    section.append(grid, note);
    return section;
  }

  // 登録済みサイト一覧と編集ボタンを作る。
  function createConfigListSection() {
    const section = createSection('登録済みサイト');
    const configs = getAllSiteConfigs();
    const table = document.createElement('table');
    table.className = 'fps-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>サイト</th>
          <th>検索ページ</th>
          <th>対象</th>
          <th>状態</th>
          <th>操作</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement('tbody');
    configs.forEach((config) => {
      const row = document.createElement('tr');
      const editButton = createButton('編集', '', () => {
        managerEditingConfigId = config.id;
        renderManager();
      });
      row.append(
        createCell(`${config.name}\n${config.host}`, 'fps-code'),
        createCell(config.searchPageUrl || '', 'fps-code'),
        createCell([
          config.inputName ? `name="${config.inputName}"` : config.keywordSelector || '',
          `submit: ${normalizeSubmitMode(config.submitMode)}`,
        ].join('\n'), 'fps-code'),
        createCell(isConfigDisabled(config) || config.enabled === false ? '無効' : '有効', ''),
        createCell(editButton, '')
      );
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  // カスタム設定のJSON入出力UIを作る。
  function createMigrationSection() {
    const section = createSection('JSON入出力');
    const textarea = document.createElement('textarea');
    textarea.className = 'fps-textarea';
    textarea.spellcheck = false;
    textarea.value = JSON.stringify({ siteConfigs: customSiteConfigs }, null, 2);

    const status = document.createElement('div');
    status.className = 'fps-status';

    const actions = document.createElement('div');
    actions.className = 'fps-actions';
    actions.append(
      createButton('現在のカスタム設定を表示', '', () => {
        textarea.value = JSON.stringify({ siteConfigs: customSiteConfigs }, null, 2);
        setStatus(status, '出力しました。', 'info');
      }),
      createButton('JSONを取り込む', 'fps-button-primary', () => {
        try {
          const payload = JSON.parse(textarea.value);
          const configs = Array.isArray(payload) ? payload : payload.siteConfigs;
          if (!Array.isArray(configs)) throw new Error('siteConfigs must be an array.');
          const normalized = configs.map(normalizeConfig).filter(Boolean).map((config) => ({
            ...config,
            custom: true,
            readonly: false,
          }));
          customSiteConfigs = normalized;
          writeValue(CUSTOM_CONFIGS_KEY, customSiteConfigs);
          reloadState();
          updateManagerButtonState();
          updateFloatingFormState();
          renderManager();
        } catch (error) {
          setStatus(status, `JSONを取り込めません: ${error.message}`, 'error');
        }
      })
    );

    section.append(textarea, actions, status);
    return section;
  }

  // 登録フォームの入力値を正規化してカスタム設定として保存する。
  function saveConfigFromForm(values) {
    const normalized = normalizeConfig({
      id: values.baseConfig?.custom ? values.baseConfig.id : createConfigId(values.host || window.location.hostname),
      name: values.name,
      host: values.host,
      enabled: true,
      custom: true,
      searchPageUrl: values.searchPageUrl,
      inputName: values.inputName,
      keywordSelector: values.keywordSelector,
      submitMode: values.submitMode,
      submitSelector: values.submitSelector,
      suggestionSelectors: values.baseConfig?.suggestionSelectors || [],
    });

    if (!normalized) return { ok: false, message: '検索ページURL、対象ホスト、セレクタを確認してください。' };

    customSiteConfigs = loadCustomSiteConfigs()
      .filter((config) => config.id !== normalized.id && config.host !== normalized.host);
    customSiteConfigs.unshift(normalized);
    writeValue(CUSTOM_CONFIGS_KEY, customSiteConfigs);
    setConfigDisabled(normalized.id, !values.enabled);
    const diagnostics = diagnoseConfigOnCurrentPage(normalized);
    const warning = !diagnostics.ok && isSearchPage(normalized);
    const message = warning
      ? `保存しました。ただし現在の検索ページでは動作確認に失敗しています。\n${formatDiagnostics(diagnostics)}`
      : '保存しました。';
    return {
      ok: true,
      warning,
      config: normalized,
      message,
    };
  }

  // 検索ページ上ならinputへフォーカスし、違うページなら検索ページへ移動する。
  function focusSearchBoxOrOpenSearchPage(config) {
    if (isSearchPage(config)) {
      const input = findSearchInput(config);
      if (input) {
        focusInput(input);
        return;
      }
    }

    if (!config.searchPageUrl) return;
    savePendingFocus(config);

    if (window.location.href !== config.searchPageUrl) {
      window.location.href = config.searchPageUrl;
      return;
    }

    retryFocus(config);
  }

  // フローティングフォームの入力値を対象サイトの検索inputへ反映する。
  function submitFloatingSearch() {
    hideFloatingSuggestions();

    if (!currentConfig || isConfigDisabled(currentConfig) || currentConfig.enabled === false) {
      showFloatingMessage('このサイトは未設定または無効です。');
      return;
    }

    const keyword = floatingInput.value.trim();
    if (!keyword) {
      floatingInput.focus();
      showFloatingMessage('検索語句を入力してください。');
      return;
    }

    if (isSearchPage(currentConfig)) {
      const input = findSearchInput(currentConfig);
      if (input) {
        focusInput(input);
        setInputValue(input, keyword);
        runConfiguredSubmit(currentConfig, input, { force: true });
        return;
      }
      showFloatingMessage('対象inputが見つかりません。設定を確認してください。');
      return;
    }

    if (!currentConfig.searchPageUrl) {
      showFloatingMessage('検索ページURLが未設定です。');
      return;
    }
    savePendingKeyword(currentConfig, keyword);
    window.location.href = currentConfig.searchPageUrl;
  }

  // 旧フローティング候補UIが残っていた場合にだけ閉じる。
  function hideFloatingSuggestions() {
    floatingSuggestions.hidden = true;
    floatingSuggestions.textContent = '';
  }

  // ページ遷移後に保留中のフォーカス要求があれば実行する。
  function maybeFocusFromPending(config) {
    const pending = readPendingRequest(PENDING_FOCUS_KEY, PENDING_FOCUS_TTL_MS);
    if (!pending) return;

    const valid =
      pending.configId === config.id &&
      Date.now() - pending.createdAt <= PENDING_FOCUS_TTL_MS &&
      isSearchPage(config);

    if (!valid) return;

    consumePendingRequest(PENDING_FOCUS_KEY);
    retryFocus(config);
  }

  // ページ遷移後に保留中の検索語句があればinputへ反映する。
  function maybeApplyPendingKeyword(config) {
    const pending = readPendingRequest(PENDING_KEYWORD_KEY, PENDING_KEYWORD_TTL_MS);
    if (!pending) return;

    const valid =
      pending.configId === config.id &&
      Date.now() - pending.createdAt <= PENDING_KEYWORD_TTL_MS &&
      typeof pending.keyword === 'string' &&
      pending.keyword.trim() &&
      isSearchPage(config);

    if (!valid) return;

    consumePendingRequest(PENDING_KEYWORD_KEY);
    retryApplyKeyword(config, pending.keyword.trim());
  }

  // 対象inputが現れるまで検索語句の反映をリトライする。
  function retryApplyKeyword(config, keyword) {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      const input = findSearchInput(config);
      if (input) {
        window.clearInterval(timer);
        focusInput(input);
        setInputValue(input, keyword);
        runConfiguredSubmit(config, input, { force: true });
        return;
      }
      if (count >= FOCUS_RETRY_COUNT) window.clearInterval(timer);
    }, FOCUS_RETRY_INTERVAL_MS);
  }

  // 対象inputが現れるまでフォーカスをリトライする。
  function retryFocus(config) {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      const input = findSearchInput(config);
      if (input) {
        window.clearInterval(timer);
        focusInput(input);
        return;
      }
      if (count >= FOCUS_RETRY_COUNT) window.clearInterval(timer);
    }, FOCUS_RETRY_INTERVAL_MS);
  }

  // サイト設定のセレクタから有効な検索inputを探す。
  function findSearchInput(config) {
    if (!config.keywordSelector) return null;
    try {
      const input = document.querySelector(config.keywordSelector);
      if (!input || !(input instanceof HTMLElement)) return null;
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return null;
      if (isHidden(input) || isDisabled(input)) return null;
      return input;
    } catch (error) {
      console.warn('[Floating Property Search] Invalid keywordSelector:', config.keywordSelector, error);
      return null;
    }
  }

  // 現在ページでサイト設定が有効に動くか診断する。
  function diagnoseConfigOnCurrentPage(config) {
    const diagnostics = {
      ok: true,
      canFocus: false,
      lines: [],
    };

    if (!isSearchPage(config)) {
      diagnostics.lines.push('検索ページ: 現在ページとは異なります');
      diagnostics.lines.push(`移動先: ${config.searchPageUrl}`);
      diagnostics.canFocus = false;
      return diagnostics;
    }

    diagnostics.lines.push('検索ページ: OK');

    const inputMatches = querySelectorAllSafe(config.keywordSelector);
    if (inputMatches.error) {
      diagnostics.ok = false;
      diagnostics.lines.push(`inputセレクタ: 不正 (${inputMatches.error})`);
      return diagnostics;
    }

    diagnostics.lines.push(`input一致数: ${inputMatches.elements.length}`);
    if (inputMatches.elements.length !== 1) diagnostics.ok = false;

    const input = inputMatches.elements[0];
    if (input && (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement))) {
      diagnostics.ok = false;
      diagnostics.lines.push('input種別: input/textareaではありません');
    } else if (input) {
      const visible = !isHidden(input);
      const enabled = !isDisabled(input);
      diagnostics.lines.push(`input状態: ${visible && enabled ? 'OK' : '確認が必要'}`);
      if (!visible || !enabled) diagnostics.ok = false;
      diagnostics.canFocus = visible && enabled;
    }

    const submitMode = normalizeSubmitMode(config.submitMode);
    diagnostics.lines.push(`検索実行: ${submitMode}`);

    if (submitMode === 'button') {
      const buttonMatches = config.submitSelector ? querySelectorAllSafe(config.submitSelector) : { elements: [], error: '' };
      if (buttonMatches.error) {
        diagnostics.ok = false;
        diagnostics.lines.push(`ボタンセレクタ: 不正 (${buttonMatches.error})`);
      } else if (config.submitSelector) {
        diagnostics.lines.push(`ボタン一致数: ${buttonMatches.elements.length}`);
        if (buttonMatches.elements.length !== 1) diagnostics.ok = false;
        const button = buttonMatches.elements[0];
        if (button && !isClickableButton(button)) {
          diagnostics.ok = false;
          diagnostics.lines.push('ボタン状態: クリック対象として確認が必要');
        }
      } else {
        diagnostics.ok = false;
        diagnostics.lines.push('ボタンCSS: 未設定');
      }
    }

    if (submitMode === 'enter' && input && !input.closest('form')) {
      diagnostics.lines.push('Enter検索: form外のためSPA側のEnter処理に依存します');
    }

    return diagnostics;
  }

  // CSSセレクタの例外を捕捉しながら要素一覧を取得する。
  function querySelectorAllSafe(selector) {
    try {
      return {
        elements: Array.from(document.querySelectorAll(selector)),
        error: '',
      };
    } catch (error) {
      return {
        elements: [],
        error: error.message || String(error),
      };
    }
  }

  // 診断結果を表示用テキストへ整形する。
  function formatDiagnostics(diagnostics) {
    const prefix = diagnostics.ok ? '設定テスト: OK' : '設定テスト: 確認が必要';
    return [prefix, ...diagnostics.lines].join('\n');
  }

  // inputへフォーカスし、可能ならテキストを選択する。
  function focusInput(input) {
    try {
      input.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch (error) {
      input.scrollIntoView();
    }

    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }

    if (typeof input.select === 'function') {
      try {
        input.select();
      } catch (error) {
        // Some input types do not allow selection. Focus is enough.
      }
    }
  }

  // React/Vue系inputにも反映されやすい方法で値をセットする。
  function setInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    if (typeof InputEvent === 'function') {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertText',
      }));
    } else {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    [80, 250, 500].forEach((delay) => {
      window.setTimeout(() => reinforceInputValue(input, value), delay);
    });
  }

  // 制御inputに値を戻された場合に遅延して再反映する。
  function reinforceInputValue(input, value) {
    if (!input || input.value === value || isDisabled(input)) return;
    input.focus();
    if (typeof input.select === 'function') input.select();
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, value)) return;
    input.setRangeText(value, 0, input.value.length, 'end');
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: value,
      inputType: 'insertText',
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // サイト設定に従ってEnter送信またはボタンクリックを実行する。
  function runConfiguredSubmit(config, input, options = {}) {
    const submitMode = resolveSubmitMode(config, options);
    if (submitMode === 'none') return;

    window.setTimeout(() => {
      if (submitMode === 'enter') {
        const canceled = dispatchEnter(input);
        if (!canceled) submitClosestForm(input);
        return;
      }

      if (submitMode === 'button') {
        const button = findSubmitButton(config, input);
        if (button) {
          button.click();
        } else {
          showFloatingMessage('検索ボタンが見つかりません。');
        }
      }
    }, 80);
  }

  // 設定と強制実行オプションから実際の送信方法を決める。
  function resolveSubmitMode(config, options = {}) {
    const submitMode = normalizeSubmitMode(config.submitMode);
    if (!options.force || submitMode !== 'none') return submitMode;
    if (config.submitSelector) return 'button';
    return 'enter';
  }

  // 対象inputへEnterキーイベント一式を送る。
  function dispatchEnter(input) {
    let canceled = false;
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      const event = new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      if (!input.dispatchEvent(event)) canceled = true;
    });
    return canceled;
  }

  // 設定セレクタまたは近いformからクリック可能な送信ボタンを探す。
  function findSubmitButton(config, input) {
    if (config.submitSelector) {
      try {
        const button = document.querySelector(config.submitSelector);
        if (isClickableButton(button)) return button;
      } catch (error) {
        console.warn('[Floating Property Search] Invalid submitSelector:', config.submitSelector, error);
      }
    }

    const form = input.closest('form');
    if (!form) return null;

    const button = form.querySelector('button[type="submit"], input[type="submit"], input[type="button"], button:not([type])');
    return isClickableButton(button) ? button : null;
  }

  // 対象inputに最も近いformをsubmit/requestSubmitする。
  function submitClosestForm(input) {
    const form = input.closest('form');
    if (!form) return;

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }

    const fallbackButton = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (isClickableButton(fallbackButton)) {
      fallbackButton.click();
      return;
    }

    form.submit();
  }

  // 要素がクリック可能なbutton/input buttonか判定する。
  function isClickableButton(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isHidden(element) || isDisabled(element)) return false;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'button') return true;
    if (tagName === 'input') {
      const type = (element.getAttribute('type') || '').toLowerCase();
      return type === 'submit' || type === 'button';
    }
    return false;
  }

  // 現在ページが設定された検索ページと同じorigin/pathか判定する。
  function isSearchPage(config) {
    if (!config.searchPageUrl) return true;
    try {
      const target = new URL(config.searchPageUrl, window.location.href);
      return window.location.origin === target.origin && window.location.pathname === target.pathname;
    } catch (error) {
      return false;
    }
  }

  // 押されたキーがフォーカス用ショートカットか判定する。
  function isFocusShortcut(event) {
    return event.ctrlKey && !event.altKey && !event.metaKey && event.key === '/';
  }

  // ページ遷移後にフォーカスするための保留状態を保存する。
  function savePendingFocus(config) {
    writePendingRequest(PENDING_FOCUS_KEY, {
      configId: config.id,
      createdAt: Date.now(),
    });
  }

  // ページ遷移後に入力する検索語句を保存する。
  function savePendingKeyword(config, keyword) {
    writePendingRequest(PENDING_KEYWORD_KEY, {
      configId: config.id,
      keyword,
      createdAt: Date.now(),
    });
  }

  // 現在タブ専用の保留リクエストを保存する。
  function writePendingRequest(key, request) {
    const tabKey = getPendingTabKey(key);
    writeValue(tabKey, {
      ...request,
      tabId: TAB_ID,
      requestId: createRequestId(),
    });
    rememberPendingKey(tabKey);
  }

  // 現在タブの保留リクエストだけを読み、期限切れは掃除する。
  function readPendingRequest(key, ttlMs) {
    const tabKey = getPendingTabKey(key);
    const pending = readValue(tabKey, null) || readLegacyPendingRequest(key);
    if (!pending) return null;

    const now = Date.now();
    if (now - Number(pending.createdAt || 0) > ttlMs) {
      deleteValue(tabKey);
      forgetPendingKey(tabKey);
      return null;
    }
    return pending;
  }

  // 現在タブの保留リクエストだけを消費済みにする。
  function consumePendingRequest(key) {
    const tabKey = getPendingTabKey(key);
    deleteValue(tabKey);
    deleteValue(key);
    forgetPendingKey(tabKey);
  }

  // 旧形式の保留リクエストを現在タブ向けなら読み取る。
  function readLegacyPendingRequest(key) {
    const saved = readValue(key, {});
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    if (!saved.configId && !saved.keyword) return null;
    if (saved.tabId && saved.tabId !== TAB_ID) return null;
    return saved;
  }

  // 保留リクエスト用のタブ専用キーを作る。
  function getPendingTabKey(key) {
    return `${key}.${TAB_ID}`;
  }

  // pending用キーを索引に追加する。
  function rememberPendingKey(key) {
    const keys = readPendingIndex();
    if (keys.includes(key)) return;
    writeValue(PENDING_INDEX_KEY, keys.concat(key));
  }

  // pending用キーを索引から外す。
  function forgetPendingKey(key) {
    const keys = readPendingIndex().filter((item) => item !== key);
    if (keys.length) {
      writeValue(PENDING_INDEX_KEY, keys);
    } else {
      deleteValue(PENDING_INDEX_KEY);
    }
  }

  // pending索引を文字列配列として読む。
  function readPendingIndex() {
    const saved = readValue(PENDING_INDEX_KEY, []);
    return Array.isArray(saved) ? uniqueNonEmpty(saved) : [];
  }

  // 期限切れのpendingリクエストを掃除する。
  function cleanupExpiredPendingRequests() {
    const keys = uniqueNonEmpty(readPendingIndex().concat(scanLocalPendingKeys()));
    const kept = [];
    keys.forEach((key) => {
      const ttlMs = key.includes(PENDING_FOCUS_KEY) ? PENDING_FOCUS_TTL_MS : PENDING_KEYWORD_TTL_MS;
      const pending = readValue(key, null);
      if (!pending || typeof pending !== 'object' || Date.now() - Number(pending.createdAt || 0) > ttlMs) {
        deleteValue(key);
        return;
      }
      kept.push(key);
    });

    if (kept.length) {
      writeValue(PENDING_INDEX_KEY, kept);
    } else {
      deleteValue(PENDING_INDEX_KEY);
    }
  }

  // localStorageフォールバック時に残ったpendingキーを列挙する。
  function scanLocalPendingKeys() {
    try {
      return Object.keys(window.localStorage)
        .filter((key) => key.startsWith(`${PENDING_FOCUS_KEY}.`) || key.startsWith(`${PENDING_KEYWORD_KEY}.`));
    } catch (error) {
      return [];
    }
  }

  // タブ内で維持する一意IDを取得する。
  function getTabId() {
    try {
      const existing = window.sessionStorage.getItem(TAB_ID_KEY);
      if (existing) return existing;
      const next = createRequestId();
      window.sessionStorage.setItem(TAB_ID_KEY, next);
      return next;
    } catch (error) {
      return createRequestId();
    }
  }

  // リクエスト識別用の短い一意IDを生成する。
  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // カスタム設定と組み込み設定を優先順で結合する。
  function getAllSiteConfigs() {
    return [...customSiteConfigs, ...bundledSiteConfigs];
  }

  // 設定フォームに表示する編集中のサイト設定を取得する。
  function getManagerFormConfig() {
    if (managerEditingConfigId) {
      const editingConfig = getAllSiteConfigs().find((config) => config.id === managerEditingConfigId);
      if (editingConfig) return editingConfig;
    }
    return currentConfig || createDraftConfigFromPage();
  }

  // 現在のhostnameに一致するサイト設定を探す。
  function findCurrentConfig() {
    const hostname = window.location.hostname;
    return getAllSiteConfigs().find((config) => hostname === config.host || hostname.endsWith(`.${config.host}`)) || null;
  }

  // 現在ページから新規サイト設定の下書きを作る。
  function createDraftConfigFromPage() {
    return normalizeConfig({
      id: createConfigId(window.location.hostname),
      name: window.location.hostname,
      host: window.location.hostname,
      enabled: true,
      custom: true,
      searchPageUrl: window.location.href,
      inputName: detectFocusedInputName() || 'keyword',
      keywordSelector: buildInputNameSelector(detectFocusedInputName() || 'keyword'),
    });
  }

  // サイト設定を保存・実行可能な形へ正規化する。
  function normalizeConfig(config) {
    if (!config || typeof config !== 'object') return null;
    const searchPageUrl = normalizeUrl(config.searchPageUrl || window.location.href);
    if (!searchPageUrl) return null;
    const host = String(config.host || new URL(searchPageUrl).hostname || '').trim();
    const inputName = String(config.inputName || getInputNameFromSelector(config.keywordSelector) || '').trim();
    const keywordSelector = String(config.keywordSelector || buildInputNameSelector(inputName)).trim();
    if (!host || !keywordSelector) return null;
    return {
      id: String(config.id || createConfigId(host)).trim(),
      name: String(config.name || host).trim(),
      host,
      enabled: config.enabled !== false,
      custom: Boolean(config.custom),
      readonly: Boolean(config.readonly),
      searchPageUrl,
      inputName,
      keywordSelector,
      submitMode: normalizeSubmitMode(config.submitMode),
      submitSelector: String(config.submitSelector || '').trim(),
      suggestionSelectors: normalizeSuggestionSelectors(config.suggestionSelectors),
    };
  }

  // 送信モードをnone/enter/buttonのいずれかに丸める。
  function normalizeSubmitMode(mode) {
    return mode === 'enter' || mode === 'button' ? mode : 'none';
  }

  // URL文字列を現在ページ基準で絶対URLへ正規化する。
  function normalizeUrl(value) {
    try {
      return new URL(String(value || '').trim(), window.location.href).href;
    } catch (error) {
      return '';
    }
  }

  // ページ内候補セレクタ配列を安全な文字列配列へ正規化する。
  function normalizeSuggestionSelectors(value) {
    if (!Array.isArray(value)) return [];
    return uniqueNonEmpty(value).slice(0, 10);
  }

  // ホスト名からカスタム設定IDを生成する。
  function createConfigId(host) {
    return `custom-${String(host || window.location.hostname).replace(/[^a-zA-Z0-9]+/g, '-')}`;
  }

  // input nameからCSSセレクタを生成する。
  function buildInputNameSelector(inputName) {
    return `input[name="${escapeAttributeValue(String(inputName || '').trim())}"]`;
  }

  // input[name=...]形式のセレクタからnameを取り出す。
  function getInputNameFromSelector(selector) {
    if (!selector) return '';
    const match = String(selector).match(/input\[name=(?:"([^"]+)"|'([^']+)'|([^\]]+))\]/);
    return match ? match[1] || match[2] || match[3] || '' : '';
  }

  // 属性値用に文字列をエスケープする。
  function escapeAttributeValue(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // 現在または直前にフォーカスしたinput nameを取得する。
  function detectFocusedInputName() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.name) return active.name;
    return lastFocusedInputName;
  }

  // ページ側で最後にフォーカスしたinput nameを記録する。
  function rememberFocusedInput(event) {
    if (event.target instanceof HTMLInputElement && event.target.name) {
      lastFocusedInputName = event.target.name;
    }
  }

  // 要素が非表示か判定する。
  function isHidden(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
  }

  // 要素がdisabledまたはaria-disabledか判定する。
  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true');
  }

  // サイト設定が無効化リストに含まれるか判定する。
  function isConfigDisabled(config) {
    return Boolean(config && disabledSites.includes(config.id));
  }

  // サイト設定の有効/無効状態を保存する。
  function setConfigDisabled(configId, disabled) {
    const latestDisabledSites = loadDisabledSites();
    disabledSites = disabled
      ? uniqueNonEmpty(latestDisabledSites.concat(configId))
      : latestDisabledSites.filter((id) => id !== configId);
    writeValue(DISABLED_SITES_KEY, disabledSites);
  }

  // ストレージからカスタムサイト設定を読み込む。
  function loadCustomSiteConfigs() {
    const saved = readValue(CUSTOM_CONFIGS_KEY, []);
    if (!Array.isArray(saved)) return [];
    return saved.map(normalizeConfig).filter(Boolean).map((config) => ({ ...config, custom: true }));
  }

  // ストレージから無効化サイト一覧を読み込む。
  function loadDisabledSites() {
    const saved = readValue(DISABLED_SITES_KEY, []);
    if (Array.isArray(saved)) return uniqueNonEmpty(saved);
    if (saved && typeof saved === 'object') return Object.keys(saved).filter((key) => saved[key]);
    return [];
  }

  // ストレージ由来の実行状態を再読み込みする。
  function reloadState() {
    customSiteConfigs = loadCustomSiteConfigs();
    disabledSites = loadDisabledSites();
    shortcutsEnabled = readValue(SHORTCUTS_KEY, { enabled: true }).enabled !== false;
    operationMode = normalizeMode(readValue(MODE_KEY, { mode: 'focus' }).mode);
    currentConfig = findCurrentConfig();
  }

  // 動作モードをfocus/floatingのいずれかに丸める。
  function normalizeMode(mode) {
    return mode === 'floating' ? 'floating' : 'focus';
  }

  // 空文字を除去し重複を消した配列を返す。
  function uniqueNonEmpty(values) {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  // 設定ボタン位置をストレージから読み込む。
  function loadManagerButtonPosition() {
    const saved = readValue(MANAGER_BUTTON_POSITION_KEY, null);
    if (!saved || typeof saved !== 'object') return null;
    const left = Number(saved.left);
    const bottom = Number(saved.bottom);
    return Number.isFinite(left) && Number.isFinite(bottom) ? { left, bottom } : null;
  }

  // 保存済み位置を設定ボタンへ適用する。
  function applyManagerButtonPosition() {
    if (!managerButtonPosition) {
      managerButton.style.left = '14px';
      managerButton.style.bottom = '14px';
      return;
    }
    const clamped = clampButtonPosition(managerButtonPosition.left, managerButtonPosition.bottom);
    managerButton.style.left = `${clamped.left}px`;
    managerButton.style.bottom = `${clamped.bottom}px`;
  }

  // 設定ボタンの無効状態とtitleを更新する。
  function updateManagerButtonState() {
    const disabled = !currentConfig || isConfigDisabled(currentConfig) || currentConfig.enabled === false;
    managerButton.dataset.disabled = disabled ? 'true' : 'false';
    managerButton.title = currentConfig
      ? `検索フォーカス設定: ${currentConfig.name}`
      : '検索フォーカス設定: 未設定';
  }

  // 現在サイト設定に応じてフローティングフォームの表示状態を更新する。
  function updateFloatingFormState() {
    const active = currentConfig && !isConfigDisabled(currentConfig) && currentConfig.enabled !== false;
    if (!active) {
      closeFloatingForm();
      return;
    }

    floatingInput.placeholder = `${currentConfig.name} を検索`;
    floatingNote.textContent = '';
    floatingForm.hidden = false;
    hideFloatingSuggestions();
  }

  // フローティングフォームを開いて入力欄へフォーカスする。
  function openFloatingForm() {
    if (!currentConfig || isConfigDisabled(currentConfig) || currentConfig.enabled === false) return;
    floatingInput.placeholder = `${currentConfig.name} を検索`;
    floatingNote.textContent = '';
    floatingForm.hidden = false;
    floatingInput.focus();
    floatingInput.select();
    hideFloatingSuggestions();
  }

  // ページ側フォーカス移動を記録し、フォーム外なら候補を閉じる。
  function handleDocumentFocusIn(event) {
    rememberFocusedInput(event);
    if (event.target === floatingInput) return;
    if (uiRoot.activeElement === floatingInput) return;
    hideFloatingSuggestions();
  }

  // フローティングフォームを閉じ、候補状態もクリアする。
  function closeFloatingForm() {
    hideFloatingSuggestions();
    floatingForm.hidden = true;
  }

  // フローティングフォーム下部の一時メッセージを表示する。
  function showFloatingMessage(message) {
    floatingNote.textContent = message;
    window.setTimeout(() => {
      if (!currentConfig || floatingForm.hidden) return;
      floatingNote.textContent = '';
    }, 3200);
  }

  // 設定ボタンのドラッグ開始状態を作る。
  function startManagerButtonDrag(event) {
    if (event.button !== 0) return;
    if (typeof managerButton.setPointerCapture === 'function') {
      managerButton.setPointerCapture(event.pointerId);
    }
    const rect = managerButton.getBoundingClientRect();
    managerButtonDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startBottom: window.innerHeight - rect.bottom,
      moved: false,
    };
    managerButton.addEventListener('pointermove', moveManagerButton);
    managerButton.addEventListener('pointerup', endManagerButtonDrag, { once: true });
    managerButton.addEventListener('pointercancel', endManagerButtonDrag, { once: true });
  }

  // ドラッグ中の設定ボタン位置を更新する。
  function moveManagerButton(event) {
    if (!managerButtonDrag || event.pointerId !== managerButtonDrag.pointerId) return;
    const dx = event.clientX - managerButtonDrag.startX;
    const dy = event.clientY - managerButtonDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) managerButtonDrag.moved = true;
    const next = clampButtonPosition(managerButtonDrag.startLeft + dx, managerButtonDrag.startBottom - dy);
    managerButton.style.left = `${next.left}px`;
    managerButton.style.bottom = `${next.bottom}px`;
    managerButtonPosition = next;
  }

  // 設定ボタンのドラッグ終了処理と位置保存を行う。
  function endManagerButtonDrag(event) {
    if (!managerButtonDrag || event.pointerId !== managerButtonDrag.pointerId) return;
    if (typeof managerButton.releasePointerCapture === 'function') {
      managerButton.releasePointerCapture(event.pointerId);
    }
    managerButton.removeEventListener('pointermove', moveManagerButton);
    if (managerButtonDrag.moved && managerButtonPosition) {
      writeValue(MANAGER_BUTTON_POSITION_KEY, managerButtonPosition);
      window.setTimeout(() => {
        managerButtonDrag = null;
      }, 0);
      return;
    }
    managerButtonDrag = null;
  }

  // 設定ボタン位置を画面内に収める。
  function clampButtonPosition(left, bottom) {
    const width = managerButton.offsetWidth || 58;
    const height = managerButton.offsetHeight || 38;
    return {
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8)),
      bottom: Math.min(Math.max(8, bottom), Math.max(8, window.innerHeight - height - 8)),
    };
  }

  // 設定UIのセクション要素を作る。
  function createSection(titleText) {
    const section = document.createElement('section');
    section.className = 'fps-section';
    const title = document.createElement('h3');
    title.textContent = titleText;
    section.appendChild(title);
    return section;
  }

  // 設定UI用のテキスト入力要素を作る。
  function createInput(value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'fps-input';
    input.value = value || '';
    return input;
  }

  // 設定UI用のボタン要素を作る。
  function createButton(text, extraClass, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fps-button ${extraClass || ''}`.trim();
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  // 設定UIのラベルとコントロールをグリッドへ追加する。
  function appendField(grid, labelText, control) {
    const label = document.createElement('div');
    label.className = 'fps-label';
    label.textContent = labelText;
    grid.append(label, control);
  }

  // チェックボックスと説明文を横並びラベルにする。
  function wrapCheckbox(input, text) {
    const label = document.createElement('label');
    label.className = 'fps-check-row';
    const span = document.createElement('span');
    span.textContent = text;
    label.append(input, span);
    return label;
  }

  // 設定一覧テーブルのセルを作る。
  function createCell(content, className) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (content instanceof Node) {
      cell.appendChild(content);
    } else {
      cell.textContent = content;
    }
    return cell;
  }

  // ステータス表示の文言と種別を更新する。
  function setStatus(element, text, kind) {
    element.textContent = text;
    element.dataset.kind = kind === 'error' ? 'error' : 'info';
  }

  // GMストレージまたはlocalStorageから値を読む。
  function readValue(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  // GMストレージまたはlocalStorageへ値を書く。
  function writeValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
      } else {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.warn('[Floating Property Search] Failed to write storage:', key, error);
    }
  }

  // GMストレージまたはlocalStorageの値を削除する。
  function deleteValue(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn('[Floating Property Search] Failed to delete storage:', key, error);
    }
  }
})();
