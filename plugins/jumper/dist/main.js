// src/types.ts
function assertCapabilities(ctx) {
  if (!ctx.domains.library || !ctx.domains.reading?.commands)
    throw new Error("Jumper requires library:read and reading:write");
}

// src/chapters.ts
function flattenToc(entries) {
  return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}
function chapterNumber(value) {
  const normalized = value.normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  if (!/^[零〇一二两兩三四五六七八九十百千万萬]+$/.test(normalized))
    return null;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 1e4, 萬: 1e4 };
  if ([...normalized].every((char) => (char in digits))) {
    const number = Number([...normalized].map((char) => digits[char]).join(""));
    return number > 0 && Number.isSafeInteger(number) ? number : null;
  }
  let total = 0, section = 0, digit = 0;
  for (const char of normalized) {
    if (char in digits)
      digit = digits[char];
    else if (units[char] === 1e4) {
      total += (section + digit || 1) * 1e4;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * units[char];
      digit = 0;
    }
  }
  return total + section + digit || null;
}
function printedNumber(label) {
  const text = label.normalize("NFKC").trim();
  const match = text.match(/^第\s*([\d零〇一二两兩三四五六七八九十百千万萬]+)\s*[章节章節回]/u) ?? text.match(/^(?:chapter|chapitre|kapitel|capítulo|глава)\s+(\d+)\b/iu) ?? text.match(/^(\d+)(?:[.)、:\s]|$)/u);
  return match ? chapterNumber(match[1]) : null;
}
function findChapters(entries, query, mode) {
  const all = flattenToc(entries);
  const number = chapterNumber(query);
  if (mode === "ordinal")
    return number === null ? [] : all.filter((entry) => entry.ordinal === number);
  if (number !== null)
    return all.filter((entry) => printedNumber(entry.label) === number);
  const title = query.normalize("NFKC").trim().toLocaleLowerCase();
  return title ? all.filter((entry) => entry.label.normalize("NFKC").toLocaleLowerCase().includes(title)) : [];
}

// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var strings = {
  searchQuery: ["Search", "搜索", "搜尋", "検索", "Поиск", "Recherche", "Suche", "Búsqueda"],
  invalidSearch: ["Search is too long or contains control characters.", "搜索内容过长或含控制字符。", "搜尋內容過長或含控制字元。", "検索文字列が長すぎるか、制御文字が含まれています。", "Запрос слишком длинный или содержит управляющие символы.", "La recherche est trop longue ou contient des caractères de contrôle.", "Die Suche ist zu lang oder enthält Steuerzeichen.", "La búsqueda es demasiado larga o contiene caracteres de control."],
  clearSearch: ["Clear search", "清除搜索", "清除搜尋", "検索をクリア", "Очистить поиск", "Effacer la recherche", "Suche löschen", "Borrar búsqueda"],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: ["Search cancelled.", "搜索已取消。", "搜尋已取消。", "検索をキャンセルしました。", "Поиск отменён.", "Recherche annulée.", "Suche abgebrochen.", "Búsqueda cancelada."],
  mode: ["Search in", "查找范围", "查找範圍", "検索対象", "Искать в", "Rechercher dans", "Suchen in", "Buscar en"],
  chapter: ["Chapter", "章节", "章節", "章", "Глава", "Chapitre", "Kapitel", "Capítulo"],
  ordinal: ["TOC order", "目录序号", "目錄序號", "目次の順番", "Порядок оглавления", "Ordre du sommaire", "Inhaltsreihenfolge", "Orden del índice"],
  text: ["Book text", "正文", "正文", "本文", "Текст книги", "Texte du livre", "Buchtext", "Texto del libro"],
  query: ["Number, title, or text", "章节号、标题或文字", "章節號、標題或文字", "番号・見出し・文字列", "Номер, заголовок или текст", "Numéro, titre ou texte", "Nummer, Titel oder Text", "Número, título o texto"],
  search: ["Find", "查找", "查找", "検索", "Найти", "Rechercher", "Suchen", "Buscar"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  matchCase: ["Match case", "区分大小写", "區分大小寫", "大文字と小文字を区別", "Учитывать регистр", "Respecter la casse", "Groß-/Kleinschreibung", "Distinguir mayúsculas"],
  wholeWords: ["Whole words", "全词匹配", "全詞匹配", "単語全体", "Слова целиком", "Mots entiers", "Ganze Wörter", "Palabras completas"],
  invalid: ["Enter 1 to 500 characters.", "请输入 1 至 500 个字符。", "請輸入 1 至 500 個字元。", "1〜500文字を入力してください。", "Введите от 1 до 500 символов.", "Saisissez de 1 à 500 caractères.", "1 bis 500 Zeichen eingeben.", "Introduce entre 1 y 500 caracteres."],
  missing: ["Chapter not found.", "该章节不存在。", "該章節不存在。", "章が見つかりません。", "Глава не найдена.", "Chapitre introuvable.", "Kapitel nicht gefunden.", "Capítulo no encontrado."],
  unavailable: ["This heading has no reading location.", "此目录标题没有可跳转的位置。", "此目錄標題沒有可跳轉的位置。", "この見出しには移動先がありません。", "У этого заголовка нет позиции для перехода.", "Ce titre n'a pas de destination.", "Diese Überschrift hat kein Sprungziel.", "Este título no tiene destino."],
  noBook: ["No book is open.", "当前没有打开的书籍。", "目前沒有開啟的書籍。", "本が開かれていません。", "Книга не открыта.", "Aucun livre ouvert.", "Kein Buch geöffnet.", "No hay ningún libro abierto."],
  noHits: ["No matches.", "没有匹配结果。", "沒有符合的結果。", "一致する結果はありません。", "Совпадений нет.", "Aucun résultat.", "Keine Treffer.", "Sin coincidencias."],
  more: ["Continue search", "继续搜索", "繼續搜尋", "検索を続ける", "Продолжить поиск", "Continuer la recherche", "Suche fortsetzen", "Continuar búsqueda"],
  pending: ["No matches in this batch.", "本批次没有匹配结果。", "本批次沒有符合的結果。", "この範囲に一致する結果はありません。", "В этой части совпадений нет.", "Aucun résultat dans cette partie.", "Keine Treffer in diesem Abschnitt.", "Sin coincidencias en esta parte."],
  timedOut: ["Search timed out.", "搜索超时。", "搜尋逾時。", "検索がタイムアウトしました。", "Поиск превысил время ожидания.", "La recherche a expiré.", "Die Suche hat das Zeitlimit überschritten.", "La búsqueda agotó el tiempo."],
  scanLimit: ["Search stopped at its section limit.", "搜索已达到分节上限。", "搜尋已達到分節上限。", "セクション上限で検索を停止しました。", "Поиск остановлен на лимите разделов.", "Recherche arrêtée à la limite de sections.", "Suche am Abschnittslimit angehalten.", "Búsqueda detenida en el límite de secciones."],
  resultLimit: ["Search stopped at its result limit.", "搜索已达到结果上限。", "搜尋已達到結果上限。", "結果上限で検索を停止しました。", "Поиск остановлен на лимите результатов.", "Recherche arrêtée à la limite de résultats.", "Suche am Ergebnislimit angehalten.", "Búsqueda detenida en el límite de resultados."],
  stale: ["The book changed; search again.", "书籍内容已变化，请重新搜索。", "書籍內容已變更，請重新搜尋。", "本の内容が変わりました。もう一度検索してください。", "Книга изменилась; выполните поиск снова.", "Le livre a changé ; relancez la recherche.", "Das Buch wurde geändert; suche erneut.", "El libro cambió; vuelve a buscar."],
  textless: ["This book has no searchable text.", "这本书没有可搜索的文本。", "這本書沒有可搜尋的文字。", "この本には検索可能なテキストがありません。", "В книге нет текста для поиска.", "Ce livre ne contient aucun texte consultable.", "Dieses Buch enthält keinen durchsuchbaren Text.", "Este libro no tiene texto que buscar."],
  unsupported: ["Text search is unavailable for some or all sections.", "部分或全部内容暂不支持文本搜索。", "部分或全部內容暫不支援文字搜尋。", "一部または全部の内容でテキスト検索が利用できません。", "Поиск недоступен для части или всей книги.", "La recherche est indisponible pour tout ou partie du livre.", "Die Textsuche ist für Teile oder das gesamte Buch nicht verfügbar.", "La búsqueda no está disponible en parte o todo el libro."]
};
function tr(locale, key) {
  const exact = locales.findIndex((value) => value.toLowerCase() === locale.toLowerCase());
  const base = locales.findIndex((value) => value === locale.split("-")[0]);
  return strings[key][exact >= 0 ? exact : base >= 0 ? base : 0];
}
// ../../packages/core/src/host-commands.ts
var PARAMETERLESS_HOST_COMMAND_IDS = [
  "go-shelf",
  "go-context",
  "go-stats",
  "open-settings",
  "select",
  "layout-grid",
  "layout-list",
  "sort-recent",
  "sort-added",
  "sort-title",
  "sort-author",
  "sort-progress",
  "group-none",
  "group-status",
  "group-author",
  "group-format"
];
var HOST_COMMAND_IDS = [...PARAMETERLESS_HOST_COMMAND_IDS, "open-book", "open-collection"];
// ../../packages/core/src/domains.ts
var DOMAIN_CATALOG = {
  library: { version: "1.31.0", pluginAccess: ["read", "write"] },
  reading: { version: "2.22.0", pluginAccess: ["read", "write"] },
  annotations: { version: "2.2.0", pluginAccess: ["read", "write"] },
  conversations: { version: "1.5.0", pluginAccess: ["read", "write"] },
  settings: { version: "1.10.0", pluginAccess: [] },
  memory: { version: "2.8.0", pluginAccess: ["read", "write"] }
};
var DOMAIN_PERMISSIONS = Object.entries(DOMAIN_CATALOG).flatMap(([domain, definition]) => definition.pluginAccess.map((access) => `${domain}:${access}`));
var FULL_DOMAIN_GRANTS = Object.freeze(Object.fromEntries(Object.keys(DOMAIN_CATALOG).map((id) => [id, "write"])));
// ../../packages/core/src/capabilities.ts
var CONTRIBUTION_CATALOG = {
  uriHandlers: { version: "1.0.0", permission: null },
  selectionActions: { version: "1.2.0", permission: null },
  headerActions: { version: "1.2.0", permission: null },
  contextActions: { version: "1.0.0", permission: null },
  commands: { version: "1.1.0", permission: null },
  settingsOptions: { version: "1.0.0", permission: null },
  voiceProviders: { version: "1.0.0", permission: null },
  contentProviders: { version: "1.0.0", permission: null },
  readerModes: { version: "1.1.0", permission: "reader:modes" },
  agentTools: { version: "1.3.0", permission: "agent:tools" },
  agentContextProviders: { version: "1.1.0", permission: "agent:context" },
  agentRetrievalProviders: { version: "1.0.0", permission: "agent:retrieval" },
  memoryCandidateProviders: { version: "1.1.0", permission: "agent:memory" },
  themes: { version: "1.0.0", permission: "ui:themes" },
  fonts: { version: "1.0.0", permission: "ui:themes" },
  syncTransports: { version: "2.0.0", permission: "sync:transport" }
};
var HOST_SERVICE_CATALOG = {
  storage: { version: "2.5.0", permission: null },
  secrets: { version: "1.0.0", permission: null },
  ui: { version: "1.15.0", permission: null },
  schedules: { version: "2.0.0", permission: null },
  jobs: { version: "1.1.0", permission: null },
  changes: { version: "1.0.0", permission: null },
  transactions: { version: "1.0.0", permission: null },
  session: { version: "2.5.0", permission: null },
  plugins: { version: "1.9.0", permission: null },
  maintenance: { version: "1.4.0", permission: null },
  diagnostics: { version: "1.2.0", permission: "service:diagnostics" },
  logging: { version: "1.0.0", permission: null },
  resources: { version: "1.5.0", permission: null },
  sync: { version: "1.1.0", permission: "service:sync" },
  network: { version: "2.2.0", permission: "service:network" },
  llm: { version: "1.6.0", permission: "service:llm" },
  clipboard: { version: "1.1.0", permission: "service:clipboard" }
};
function declaredPermissions(catalog) {
  return [...new Set(Object.values(catalog).flatMap((entry) => entry.permission === null ? [] : [entry.permission]))];
}
var PLUGIN_PERMISSIONS = [
  ...DOMAIN_PERMISSIONS,
  ...declaredPermissions(CONTRIBUTION_CATALOG),
  ...declaredPermissions(HOST_SERVICE_CATALOG)
];
// ../../packages/core/src/context-bundle.ts
var CONTEXT_BUNDLE_MAX_BYTES = 1024 * 1024;
// ../../packages/core/src/resource-external-formats.json
var resource_external_formats_default = ["epub", "pdf", "txt", "fb2", "mobi", "azw", "azw3", "cbz", "cbr", "png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "m4v", "webm", "mov", "rtf", "docx", "odt", "xlsx", "ods", "pptx", "odp", "prc", "kf8", "fbz", "zip", "html", "htm"];

// ../../packages/core/src/resources.ts
var RESOURCE_EXTERNAL_EXTENSIONS = Object.freeze(resource_external_formats_default);
var RESOURCE_MAX_CHUNK = 1024 * 1024;
var RESOURCE_MAX_SIZE = 1024 * 1024 * 1024;
var RESOURCE_LIFETIME_MS = 60 * 60 * 1000;
// ../../packages/core/src/resource-download.ts
var RESOURCE_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
// ../../packages/core/src/book-images.ts
var BOOK_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
// ../../packages/core/src/plugin-assets.ts
var PLUGIN_ASSET_MAX_BYTES = 64 * 1024 * 1024;
var PLUGIN_ASSET_TOTAL_BYTES = 512 * 1024 * 1024;
// ../../packages/core/src/model-image.ts
var MODEL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
var MODEL_IMAGES_MAX_BYTES = 16 * 1024 * 1024;
// ../../packages/core/src/plugin-services.ts
var PLUGIN_SERVICE_LIMITS = { bytes: 1024 * 1024, depth: 16, nodes: 16000, schemas: 512, timeoutMs: 120000 };
// ../../packages/plugin-types/src/book-location-search.ts
var HARD_MAX_SECTIONS = 256;
var HARD_MAX_HITS = 200;
var HARD_MAX_EXCERPT_BYTES = 64 * 1024;
var HARD_MAX_TIMEOUT_MS = 30000;
var MAX_PAGE_SIZE = 50;
var MAX_PAGE_CALLS = 256;
var HIT_OVERHEAD_BYTES = 128;
var TEXT_STATUSES = new Set([
  "available",
  "textless",
  "unsupported",
  "unsearched",
  "partial"
]);
function optionLimit(value, fallback, hardMax, name) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMax) {
    throw Object.assign(new Error(`${name} is outside the bounded search limit`), { code: "library/invalid-search-options" });
  }
  return value;
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function isStale(error) {
  const code = errorCode(error);
  return code === "reader/stale-location" || code === "reader/stale-content";
}
function isCancelled(error) {
  const code = errorCode(error);
  return code === "library/cancelled" || code === "plugin/cancelled" || typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}
function invalidPage(message) {
  return Object.assign(new Error(message), { code: "library/search-invalid-page" });
}
function validatePage(page, expectedBookId, expectedTotal, previousScanned, requestCursor) {
  if (!page || typeof page !== "object" || page.bookId !== expectedBookId || typeof page.contentVersion !== "string" || !page.contentVersion || !Array.isArray(page.hits) || page.hits.length > MAX_PAGE_SIZE || !Number.isSafeInteger(page.scannedSections) || page.scannedSections < 0 || !Number.isSafeInteger(page.totalSections) || page.totalSections < 0 || page.scannedSections > page.totalSections || page.scannedSections < previousScanned || expectedTotal !== null && page.totalSections !== expectedTotal || !TEXT_STATUSES.has(page.textStatus) || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 1024)) {
    throw invalidPage("Search page counters or shape are invalid");
  }
  if (page.nextCursor === null && page.scannedSections !== page.totalSections) {
    throw invalidPage("A terminal search page must account for every section");
  }
  if (page.nextCursor !== null && page.nextCursor === requestCursor) {
    throw invalidPage("Search cursor did not advance");
  }
  for (const hit of page.hits) {
    if (!hit || typeof hit !== "object" || typeof hit.id !== "string" || !hit.excerpt || typeof hit.excerpt.pre !== "string" || typeof hit.excerpt.match !== "string" || typeof hit.excerpt.post !== "string") {
      throw invalidPage("Search page contains an invalid hit");
    }
  }
}
function combineSignal(source) {
  const controller = new AbortController;
  const abort = () => {
    if (!controller.signal.aborted)
      controller.abort();
  };
  if (source) {
    source.addEventListener("abort", abort, { once: true });
    if (source.aborted)
      abort();
  }
  return {
    signal: controller.signal,
    abort,
    dispose: () => source?.removeEventListener("abort", abort)
  };
}
function awaitAbortable(promise, signal, status) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: "aborted", status: status() ?? "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish({ kind: "value", value }), (error) => finish({ kind: "error", error }));
    if (signal.aborted)
      onAbort();
  });
}
function runResult(bookId, status, contentVersion, hits, scannedSections, totalSections, textStatus) {
  return { status, bookId, contentVersion, hits, scannedSections, totalSections, textStatus };
}
async function searchAllBookLocations(reader, input, options = {}) {
  const maxSections = optionLimit(options.maxSections, HARD_MAX_SECTIONS, HARD_MAX_SECTIONS, "maxSections");
  const maxHits = optionLimit(options.maxHits, HARD_MAX_HITS, HARD_MAX_HITS, "maxHits");
  const maxExcerptBytes = optionLimit(options.maxExcerptBytes, HARD_MAX_EXCERPT_BYTES, HARD_MAX_EXCERPT_BYTES, "maxExcerptBytes");
  const timeoutMs = optionLimit(options.timeoutMs, HARD_MAX_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS, "timeoutMs");
  const encoder = new TextEncoder;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let timeoutHandle;
  const combined = combineSignal(options.signal);
  const abortStatus = () => {
    if (options.signal?.aborted)
      return "cancelled";
    if (timedOut || Date.now() >= deadline) {
      timedOut = true;
      return "timed-out";
    }
    return null;
  };
  timeoutHandle = setTimeout(() => {
    timedOut = true;
    combined.abort();
  }, timeoutMs);
  let version = null;
  let totalSections = 0;
  let expectedTotal = null;
  let scannedSections = 0;
  let textStatus = "unsearched";
  let cursor = input.cursor;
  let pageCalls = 0;
  let excerptBytes = 0;
  const hits = [];
  const seenCursors = new Set;
  if (cursor)
    seenCursors.add(cursor);
  const terminal = (status) => runResult(input.bookId, status, status === "stale" ? null : version, [], scannedSections, totalSections, textStatus);
  const emitProgress = async () => {
    const callback = options.onProgress;
    if (!callback)
      return null;
    const outcome = await awaitAbortable(Promise.resolve().then(() => callback({
      scannedSections,
      totalSections,
      hitCount: hits.length,
      contentVersion: version
    })), combined.signal, abortStatus);
    if (outcome.kind === "aborted")
      return terminal(outcome.status);
    if (outcome.kind === "error")
      throw outcome.error;
    return null;
  };
  try {
    if (abortStatus())
      return terminal(abortStatus());
    while (true) {
      if (pageCalls >= MAX_PAGE_CALLS)
        return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
      const beforePage = abortStatus();
      if (beforePage)
        return terminal(beforePage);
      const request = {
        ...input,
        limit: Math.min(input.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE, maxHits - hits.length || 1),
        ...cursor ? { cursor } : {},
        ...version ? { contentVersion: version } : {}
      };
      const pageOutcome = await awaitAbortable(Promise.resolve().then(() => reader(request, { signal: combined.signal })), combined.signal, abortStatus);
      if (pageOutcome.kind === "aborted")
        return terminal(pageOutcome.status);
      if (pageOutcome.kind === "error") {
        if (isStale(pageOutcome.error))
          return terminal("stale");
        if (isCancelled(pageOutcome.error))
          return terminal(abortStatus() ?? "cancelled");
        throw pageOutcome.error;
      }
      const page = pageOutcome.value;
      validatePage(page, input.bookId, expectedTotal, scannedSections, cursor);
      if (version !== null && page.contentVersion !== version)
        return terminal("stale");
      if (version === null) {
        if (input.contentVersion && page.contentVersion !== input.contentVersion)
          return terminal("stale");
        version = page.contentVersion;
      }
      if (page.nextCursor && seenCursors.has(page.nextCursor))
        throw invalidPage("Search cursor was repeated");
      if (expectedTotal === null)
        expectedTotal = page.totalSections;
      totalSections = expectedTotal;
      scannedSections = page.scannedSections;
      textStatus = page.textStatus;
      pageCalls++;
      const remainingBytes = maxExcerptBytes - excerptBytes;
      let resultLimited = false;
      for (const hit of page.hits) {
        const hitBytes = encoder.encode(hit.excerpt.pre).byteLength + encoder.encode(hit.excerpt.match).byteLength + encoder.encode(hit.excerpt.post).byteLength + HIT_OVERHEAD_BYTES;
        if (hits.length >= maxHits || hitBytes > remainingBytes || excerptBytes + hitBytes > maxExcerptBytes) {
          resultLimited = true;
          break;
        }
        hits.push(hit);
        excerptBytes += hitBytes;
      }
      const progressResult = await emitProgress();
      if (progressResult)
        return progressResult;
      if (resultLimited)
        return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      const afterPage = abortStatus();
      if (afterPage)
        return terminal(afterPage);
      if (!page.nextCursor)
        return runResult(input.bookId, "completed", version, hits, scannedSections, totalSections, textStatus);
      if (hits.length >= maxHits)
        return runResult(input.bookId, "result-limit", version, hits, scannedSections, totalSections, textStatus);
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
      if (scannedSections >= maxSections)
        return runResult(input.bookId, "scan-limit", version, hits, scannedSections, totalSections, textStatus);
    }
  } finally {
    if (timeoutHandle !== undefined)
      clearTimeout(timeoutHandle);
    combined.dispose();
  }
}
// src/text-search.ts
function textSearchView(ctx, input) {
  const controller = new AbortController;
  let channel, revision = 0, started = false, pending = true;
  const retry = {
    id: "retry",
    label: tr(ctx.locale, "search"),
    icon: "magnifying-glass",
    run: () => ({ view: textSearchView(ctx, input), navigation: "replace" })
  };
  const cancelled = () => ({
    kind: "list",
    title: input.query,
    items: [],
    emptyText: tr(ctx.locale, "cancelled"),
    actions: [retry]
  });
  const progress = (value) => ({ kind: "blocks", title: input.query, blocks: [
    {
      kind: "progress",
      value: value.totalSections ? Math.min(value.scannedSections, value.totalSections) : null,
      ...value.totalSections ? { max: value.totalSections, showValue: true } : {},
      label: value.totalSections ? `${tr(ctx.locale, "searching")} (${value.scannedSections}/${value.totalSections})` : tr(ctx.locale, "searching"),
      cancel: {
        id: "cancel",
        label: tr(ctx.locale, "cancel"),
        run: async () => {
          stop();
          await publish();
        }
      }
    }
  ] });
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = cancelled();
    }
  };
  let current = { kind: "blocks", title: input.query, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel",
      label: tr(ctx.locale, "cancel"),
      run: async () => {
        stop();
        await publish();
      }
    } }
  ] };
  const publish = async () => {
    if (!channel)
      return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) {
        channel = undefined;
        stop();
      }
    } catch (error) {
      console.warn("Jumper search view publication failed", error);
      if (channel === target) {
        channel = undefined;
        stop();
      }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted)
      return;
    try {
      const run = await searchAllBookLocations((pageInput, options) => ctx.domains.library.queries.books.searchLocations(pageInput, options), input, { signal: controller.signal, onProgress: async (value) => {
        if (controller.signal.aborted || !pending)
          return;
        current = progress(value);
        await publish();
      } });
      if (controller.signal.aborted)
        return;
      if (run.status === "cancelled") {
        pending = false;
        current = cancelled();
        await publish();
        return;
      }
      const emptyKey = run.status === "timed-out" ? "timedOut" : run.status === "scan-limit" ? "scanLimit" : run.status === "result-limit" ? "resultLimit" : run.status === "stale" ? "stale" : run.textStatus === "textless" ? "textless" : run.textStatus === "unsupported" || run.textStatus === "partial" ? "unsupported" : "noHits";
      const resultTitle = run.status === "completed" ? input.query : `${input.query} · ${tr(ctx.locale, emptyKey)}`;
      const result = {
        kind: "list",
        title: resultTitle,
        emptyText: tr(ctx.locale, emptyKey),
        items: run.hits.map((hit) => ({
          id: hit.id,
          title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
          icon: "magnifying-glass",
          onSelect: async () => {
            await ctx.domains.reading.commands.goTo(hit.location);
            return { close: true };
          }
        })),
        actions: run.status === "timed-out" || run.status === "scan-limit" || run.status === "result-limit" ? [retry] : []
      };
      current = result;
    } catch (error) {
      if (controller.signal.aborted)
        return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title: input.query, blocks: [
        { kind: "error", code },
        ...retryable ? [{ kind: "actions", actions: [retry] }] : []
      ] };
    }
    pending = false;
    await publish();
  };
  return { ...current, onClose: stop, live: { subscribe(next) {
    channel = next;
    if (!started) {
      started = true;
      search();
    } else
      publish();
    return { dispose() {
      if (channel === next) {
        channel = undefined;
        stop();
      }
    } };
  } } };
}

// src/navigation-strings.ts
var en = {
  navigation: "Navigation",
  sections: "Source sections",
  pages: "Book page labels",
  section: "Source section",
  page: "Page label",
  screen: "Screen in this section",
  empty: "No matching targets",
  absent: "Page labels unavailable",
  unlocated: "No reading location",
  number: "Section number",
  jump: "Go",
  invalidSection: "Enter an existing positive section number",
  invalidLabel: "Enter a page label of 1-300 characters",
  findPage: "Find page label",
  refresh: "Refresh",
  nonLinear: "Non-linear section",
  next: "Next screen",
  previous: "Previous screen",
  "next-section": "Next source section",
  "previous-section": "Previous source section",
  "next-chapter": "Next TOC heading",
  "previous-chapter": "Previous TOC heading",
  start: "Start of book",
  end: "End of book"
};
var zh = {
  navigation: "导航",
  sections: "源分节",
  pages: "原书页码",
  section: "源分节",
  page: "页码标签",
  screen: "本分节屏幕页",
  empty: "没有匹配目标",
  absent: "暂无可用的页码标签",
  unlocated: "没有可跳转的位置",
  number: "分节序号",
  jump: "跳转",
  invalidSection: "请输入存在的正整数分节序号",
  invalidLabel: "请输入 1-300 个字符的页码标签",
  findPage: "查找页码标签",
  refresh: "刷新",
  nonLinear: "非线性分节",
  next: "下一屏",
  previous: "上一屏",
  "next-section": "下一源分节",
  "previous-section": "上一源分节",
  "next-chapter": "下一目录标题",
  "previous-chapter": "上一目录标题",
  start: "书首",
  end: "书尾"
};
var navigationWords = (locale) => locale === "zh-Hans" ? zh : en;

// src/navigation.ts
var steps = [
  { id: "previous", icon: "arrow-left" },
  { id: "next", icon: "arrow-right" },
  { id: "previous-section", icon: "skip-back" },
  { id: "next-section", icon: "skip-forward" },
  { id: "previous-chapter", icon: "caret-left" },
  { id: "next-chapter", icon: "caret-right" },
  { id: "start", icon: "arrow-line-left" },
  { id: "end", icon: "arrow-line-right" }
];
async function navigate(ctx, target) {
  await ctx.domains.reading.commands.goTo(target);
  return { close: true };
}
async function navigationView(ctx) {
  const t = navigationWords(ctx.locale), session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.sessionId || !session.location) {
    throw Object.assign(Error("Navigation requires a ready reader"), { code: "reader/unavailable" });
  }
  const source = { bookId: session.bookId, contentVersion: session.location.contentVersion };
  const guard = { bookId: session.bookId, sessionId: session.sessionId };
  const pagination = session.pagination;
  return { kind: "detail", title: t.navigation, content: [
    ...pagination ? [{ kind: "keyValue", rows: [
      { label: t.section, value: `${pagination.section.index + 1} / ${pagination.section.count}` },
      ...pagination.screen ? [{ label: t.screen, value: `${pagination.screen.index + 1} / ${pagination.screen.count}` }] : []
    ] }] : [],
    { kind: "list", items: [
      { id: "sections", title: t.sections, icon: "list-bullets", onSelect: async () => ({ view: await navigationTargets(ctx, source, "sections") }) },
      { id: "pages", title: t.pages, icon: "files", onSelect: async () => ({ view: await navigationTargets(ctx, source, "pages") }) },
      ...steps.map((step) => ({ id: step.id, title: t[step.id], icon: step.icon, onSelect: async () => {
        await ctx.domains.reading.commands.step(step.id, guard);
        return { close: true };
      } }))
    ] }
  ], actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await navigationView(ctx), navigation: "replace" }) }] };
}
async function navigationTargets(ctx, source, kind, offsets = [0], label) {
  const t = navigationWords(ctx.locale);
  const page = await ctx.domains.library.queries.books.listNavigationTargets({
    ...source,
    kind,
    offset: offsets[offsets.length - 1],
    limit: 40,
    ...label === undefined ? {} : { label }
  });
  const go = async (next) => ({ view: await navigationTargets(ctx, source, kind, next, label), navigation: "replace" });
  return {
    kind: "list",
    title: kind === "sections" ? t.sections : t.pages,
    emptyText: page.status === "absent" ? t.absent : t.empty,
    items: page.items.map((item) => ({
      id: String(item.index),
      title: item.label ? `${item.label}${item.labelTruncated ? "..." : ""}` : `${kind === "sections" ? t.section : t.page} ${item.index + 1}`,
      icon: "file-text",
      subtitle: [item.location ? "" : t.unlocated, item.linear === false ? t.nonLinear : ""].filter(Boolean).join(" / "),
      ...item.location ? { onSelect: () => navigate(ctx, item.location) } : {}
    })),
    actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => {
        const toc = await ctx.domains.library.queries.books.getNavigationToc(source.bookId);
        return { view: await navigationTargets(ctx, { bookId: toc.bookId, contentVersion: toc.contentVersion }, kind, [0], label), navigation: "replace" };
      } },
      ...page.status === "available" && (kind === "pages" || page.total > 0) ? [{ id: "find", label: kind === "sections" ? t.number : t.findPage, icon: "magnifying-glass", run: () => ({ view: kind === "sections" ? {
        kind: "form",
        title: t.sections,
        submitLabel: t.jump,
        fields: [{ id: "number", kind: "number", label: t.number, min: 1, max: page.total, step: 1 }],
        onSubmit: async (values) => {
          const number = values.number;
          if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > page.total)
            return { fieldErrors: { number: t.invalidSection } };
          return navigate(ctx, { ...source, sectionIndex: number - 1 });
        }
      } : {
        kind: "form",
        title: t.findPage,
        submitLabel: t.jump,
        fields: [{ id: "label", kind: "text", label: t.page, value: label ?? "" }],
        onSubmit: async (values) => {
          if (typeof values.label !== "string" || !values.label.trim() || values.label.length > 300)
            return { fieldErrors: { label: t.invalidLabel } };
          return { view: await navigationTargets(ctx, source, "pages", [0], values.label) };
        }
      } }) }] : []
    ],
    pagination: {
      page: offsets.length,
      ...offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {},
      ...page.nextOffset === null ? {} : { onNext: () => go([...offsets, page.nextOffset]) }
    }
  };
}

// src/bookmarks.ts
var BOOKMARKS = "bookmarks";
var bookmarkCollection = (ctx) => ctx.services.storage.collection(BOOKMARKS);
var object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
var text = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
function bookmarkName(value) {
  return text(value, 120) ? value.trim() : null;
}
function bookmarkSearchQuery(value) {
  return typeof value === "string" && new TextEncoder().encode(value).length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value.trim() : null;
}
function targetOf(raw) {
  if (!object(raw) || !text(raw.bookId, 512) || !text(raw.contentVersion, 256))
    return null;
  const target = { bookId: raw.bookId, contentVersion: raw.contentVersion };
  if (raw.cfi !== undefined) {
    if (!text(raw.cfi, 8192))
      return null;
    target.cfi = raw.cfi;
  } else if (raw.href !== undefined) {
    if (!text(raw.href, 8192))
      return null;
    target.href = raw.href;
  } else if (typeof raw.fraction === "number" && Number.isFinite(raw.fraction) && raw.fraction >= 0 && raw.fraction <= 1)
    target.fraction = raw.fraction;
  else
    return null;
  if (raw.textQuote !== undefined) {
    const quote = raw.textQuote;
    if (!object(quote) || !text(quote.exact, 12000))
      return null;
    target.textQuote = { exact: quote.exact };
    for (const key of ["prefix", "suffix"])
      if (quote[key] !== undefined) {
        if (typeof quote[key] !== "string" || quote[key].length > 2000)
          return null;
        target.textQuote[key] = quote[key];
      }
  }
  return target;
}
function parseBookmark(value) {
  if (!object(value) || value.version !== 1 || !bookmarkName(value.name) || !text(value.bookTitle, 500) || value.kind !== "location" && value.kind !== "selection")
    return null;
  const target = targetOf(value.target);
  if (!target || value.kind === "selection" && !target.cfi)
    return null;
  return { version: 1, name: bookmarkName(value.name), bookTitle: value.bookTitle, kind: value.kind, target };
}
async function captureBookmark(ctx, kind) {
  const session = await ctx.domains.reading.queries.session();
  if (session.status !== "ready" || !session.bookId || !session.location) {
    throw Object.assign(Error("Bookmark requires a ready reader"), { code: "reader/unavailable" });
  }
  const target = targetOf(kind === "selection" ? session.selection?.range : session.location);
  if (!target || target.bookId !== session.bookId || target.contentVersion !== session.location.contentVersion) {
    throw Object.assign(Error("Bookmark location is unavailable"), { code: "reader/stale-location" });
  }
  const selectionName = session.selection?.text.trim().slice(0, 120);
  const book = await ctx.domains.library.queries.books.get(target.bookId);
  if (!book)
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  const bookTitle = book.title.trim().slice(0, 500) || book.id;
  return {
    version: 1,
    name: (kind === "selection" ? selectionName : bookTitle.slice(0, 120)) || bookTitle.slice(0, 120),
    bookTitle,
    kind,
    target
  };
}
async function writeBookmark(ctx, id, data, expectedRevision) {
  return ctx.services.storage.applyDocuments([{
    kind: "put",
    collection: BOOKMARKS,
    id,
    data,
    bookId: data.target.bookId,
    ...data.target.cfi ? { anchor: data.target.cfi } : {},
    expectedRevision
  }]);
}
async function removeBookmark(ctx, doc) {
  return ctx.services.storage.applyDocuments([{ kind: "delete", collection: BOOKMARKS, id: doc.id, expectedRevision: doc.revision }]);
}
async function openBookmark(ctx, bookmark) {
  if (!await ctx.domains.library.queries.books.get(bookmark.target.bookId)) {
    throw Object.assign(Error("Bookmark book missing"), { code: "library/book-not-found" });
  }
  await ctx.domains.reading.commands.goTo(structuredClone(bookmark.target));
  return { close: true };
}

// src/bookmark-strings.ts
var en2 = {
  title: "Bookmarks",
  empty: "No bookmarks",
  name: "Name",
  save: "Save bookmark",
  saved: "Bookmark saved",
  current: "Bookmark current location",
  selection: "Bookmark selection",
  location: "Reading location",
  range: "Selected passage",
  open: "Go to bookmark",
  rename: "Rename",
  renamed: "Bookmark renamed",
  remove: "Delete bookmark",
  removed: "Bookmark deleted",
  confirm: "Delete this bookmark",
  invalidName: "Enter a name of 1-120 characters.",
  required: "Confirm deletion.",
  invalid: "Bookmark data unavailable",
  missing: "Bookmark no longer exists",
  stale: "Bookmarks changed. Refresh the list.",
  conflict: "This bookmark changed. Refresh before trying again.",
  refresh: "Refresh",
  all: "All books",
  thisBook: "Current book",
  version: "Source version",
  book: "Book",
  kind: "Type"
};
var zh2 = {
  title: "书签",
  empty: "暂无书签",
  name: "名称",
  save: "保存书签",
  saved: "书签已保存",
  current: "收藏当前位置",
  selection: "收藏选区",
  location: "阅读位置",
  range: "选中段落",
  open: "跳转到书签",
  rename: "重命名",
  renamed: "书签已重命名",
  remove: "删除书签",
  removed: "书签已删除",
  confirm: "删除这条书签",
  invalidName: "请输入 1-120 个字符的名称。",
  required: "请确认删除。",
  invalid: "书签数据不可用",
  missing: "书签已不存在",
  stale: "书签列表已变化，请刷新。",
  conflict: "这条书签已变化，请刷新后再试。",
  refresh: "刷新",
  all: "全部书籍",
  thisBook: "当前书籍",
  version: "内容版本",
  book: "书籍",
  kind: "类型"
};
var bookmarkCopy = (locale) => locale.startsWith("zh") ? zh2 : en2;

// src/live-bookmarks.ts
async function liveBookmarks(ctx, query, read, render) {
  const failure = (errorCode2) => ({
    kind: "detail",
    title: bookmarkCopy(ctx.locale).title,
    content: [{ kind: "error", code: errorCode2 }],
    actions: [{
      id: "refresh",
      label: bookmarkCopy(ctx.locale).refresh,
      icon: "arrows-clockwise",
      run: async () => ({ view: await liveBookmarks(ctx, query, read, render), navigation: "replace" })
    }]
  });
  const code = (error) => error && typeof error === "object" && ("code" in error) && typeof error.code === "string" ? error.code : "ipc/unknown";
  const content = async (result) => {
    try {
      return await render(result);
    } catch (error) {
      return failure(code(error));
    }
  };
  let initial;
  try {
    initial = await content(await read());
  } catch (error) {
    initial = failure(code(error));
  }
  return { ...initial, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.services.storage.observeDocuments(query, async (event, delivery) => {
      if (disposed)
        return;
      const reaction = ctx.withEvent(delivery);
      const view = event.status === "ready" ? await content(event.result) : failure(event.errorCode);
      if (!disposed)
        await reaction.services.ui.publishView(channel, { revision: ++revision, view });
    });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/bookmark-views.ts
function message(ctx, text2, refresh = () => bookmarksView(ctx)) {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text: text2 }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "reset" }) }
  ] };
}
function nameForm(ctx, data, id, expectedRevision) {
  const t = bookmarkCopy(ctx.locale);
  return {
    kind: "form",
    title: data.bookTitle,
    submitLabel: expectedRevision === null ? t.save : t.rename,
    fields: [{ id: "name", kind: "text", label: t.name, value: data.name }],
    onSubmit: async (values) => {
      const name = bookmarkName(values.name);
      if (!name)
        return { fieldErrors: { name: t.invalidName } };
      const receipt = await writeBookmark(ctx, id, { ...data, name }, expectedRevision);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : expectedRevision === null ? t.saved : t.renamed), navigation: "replace" };
    }
  };
}
async function saveBookmarkView(ctx, kind) {
  const data = await captureBookmark(ctx, kind), t = bookmarkCopy(ctx.locale);
  return { kind: "blocks", blocks: [
    { kind: "text", text: kind === "selection" ? t.range : t.location },
    nameForm(ctx, data, crypto.randomUUID(), null)
  ] };
}
function deleteForm(ctx, doc) {
  const t = bookmarkCopy(ctx.locale), bookmark = parseBookmark(doc.data);
  return {
    kind: "form",
    title: bookmark?.name ?? t.invalid,
    submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirm, value: false }],
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t.required } };
      const receipt = await removeBookmark(ctx, doc);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : t.removed), navigation: "replace" };
    }
  };
}
async function bookmarkDetail(ctx, id) {
  const t = bookmarkCopy(ctx.locale);
  return liveBookmarks(ctx, { kind: "get", collection: BOOKMARKS, id }, async () => ({ kind: "get", document: await bookmarkCollection(ctx).get(id) }), async (result) => {
    if (result.kind !== "get")
      throw Error("Expected bookmark document");
    const doc = result.document;
    if (!doc)
      return message(ctx, t.missing);
    const bookmark = parseBookmark(doc.data);
    return {
      kind: "detail",
      title: bookmark?.name ?? t.invalid,
      content: bookmark ? [{ kind: "keyValue", rows: [
        { label: t.book, value: bookmark.bookTitle },
        { label: t.kind, value: bookmark.kind === "selection" ? t.range : t.location },
        { label: t.version, value: bookmark.target.contentVersion }
      ] }] : [{ kind: "text", text: t.invalid }],
      actions: [
        ...bookmark ? [
          { id: "open", label: t.open, icon: "arrow-right", run: () => openBookmark(ctx, bookmark) },
          { id: "rename", label: t.rename, icon: "pencil-simple", run: () => ({ view: nameForm(ctx, bookmark, doc.id, doc.revision) }) }
        ] : [],
        { id: "remove", label: t.remove, icon: "trash", run: () => ({ view: deleteForm(ctx, doc) }) },
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookmarkDetail(ctx, id), navigation: "replace" }) }
      ]
    };
  });
}
async function bookmarksView(ctx, bookId, cursors = [undefined], query) {
  const t = bookmarkCopy(ctx.locale);
  const filter = { bookId, limit: 40, cursor: cursors[cursors.length - 1], ...query ? { query } : {} };
  return liveBookmarks(ctx, { kind: "page", collection: BOOKMARKS, filter }, async () => ({ kind: "page", page: await bookmarkCollection(ctx).page(filter) }), async (result) => {
    if (result.kind !== "page")
      throw Error("Expected bookmark page");
    const page = result.page;
    if (page.status === "stale-cursor")
      return message(ctx, t.stale, () => bookmarksView(ctx, bookId, [undefined], query));
    const session = await ctx.domains.reading.queries.session();
    const ready = session.status === "ready" && session.location && session.bookId;
    const next = async (values) => ({ view: await bookmarksView(ctx, bookId, values, query), navigation: "replace" });
    return {
      kind: "list",
      title: t.title,
      emptyText: query ? tr(ctx.locale, "noHits") : t.empty,
      items: page.items.map((doc) => {
        const bookmark = parseBookmark(doc.data);
        return {
          id: doc.id,
          title: bookmark?.name ?? t.invalid,
          subtitle: bookmark?.bookTitle,
          timestamp: doc.updatedAt,
          icon: "book-bookmark",
          onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) })
        };
      }),
      actions: [
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: () => next([undefined]) },
        { id: "search", label: tr(ctx.locale, "search"), icon: "magnifying-glass", run: () => ({ view: {
          kind: "form",
          title: t.title,
          submitLabel: tr(ctx.locale, "search"),
          fields: [{ kind: "text", id: "query", label: tr(ctx.locale, "searchQuery"), value: query ?? "" }],
          onSubmit: async (values) => {
            const search = bookmarkSearchQuery(values.query);
            if (search === null)
              return { fieldErrors: { query: tr(ctx.locale, "invalidSearch") } };
            return { view: await bookmarksView(ctx, bookId, [undefined], search || undefined), navigation: "replace" };
          }
        } }) },
        ...query ? [{ id: "clear-search", label: tr(ctx.locale, "clearSearch"), icon: "x", run: async () => ({ view: await bookmarksView(ctx, bookId), navigation: "replace" }) }] : [],
        ...ready ? [
          { id: "save-location", label: t.current, icon: "plus", run: async () => ({ view: await saveBookmarkView(ctx, "location") }) },
          ...session.selection?.range ? [{ id: "save-selection", label: t.selection, icon: "highlighter", run: async () => ({ view: await saveBookmarkView(ctx, "selection") }) }] : []
        ] : [],
        ...bookId ? [{ id: "all", label: t.all, icon: "books", run: async () => ({ view: await bookmarksView(ctx, undefined, [undefined], query), navigation: "replace" }) }] : ready ? [{ id: "this-book", label: t.thisBook, icon: "book-open", run: async () => ({ view: await bookmarksView(ctx, session.bookId, [undefined], query), navigation: "replace" }) }] : []
      ],
      pagination: {
        page: cursors.length,
        ...cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {},
        ...page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor]) } : {}
      }
    };
  });
}

// src/views.ts
async function jump(ctx, location) {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}
function chapterResults(ctx, entries) {
  return { kind: "list", items: entries.map((entry) => ({
    id: entry.id,
    title: entry.label || String(entry.ordinal),
    icon: "book-open",
    subtitle: `${tr(ctx.locale, "ordinal")}: ${entry.ordinal}`,
    ...entry.location ? { onSelect: () => jump(ctx, entry.location) } : { subtitle: tr(ctx.locale, "unavailable") }
  })) };
}
async function jumperView(ctx) {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId)
    return { kind: "list", items: [], emptyText: tr(ctx.locale, "noBook") };
  const bookId = session.bookId;
  const form = {
    kind: "form",
    submitLabel: tr(ctx.locale, "search"),
    fields: [
      { kind: "choice", id: "mode", label: tr(ctx.locale, "mode"), value: "chapter", options: [
        { value: "chapter", label: tr(ctx.locale, "chapter"), icon: "book-open" },
        { value: "ordinal", label: tr(ctx.locale, "ordinal"), icon: "list-bullets" },
        { value: "text", label: tr(ctx.locale, "text"), icon: "magnifying-glass" }
      ] },
      { kind: "text", id: "query", label: tr(ctx.locale, "query") },
      { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false, visibleWhen: { field: "mode", equals: "text" } },
      { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false, visibleWhen: { field: "mode", equals: "text" } }
    ],
    onSubmit: async (values) => {
      const query = String(values.query ?? "").trim();
      if (!query || query.length > 500)
        return { fieldErrors: { query: tr(ctx.locale, "invalid") } };
      if (values.mode === "text")
        return { view: textSearchView(ctx, {
          bookId,
          query,
          limit: 20,
          matchCase: values.matchCase === true,
          wholeWords: values.wholeWords === true
        }) };
      const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
      const entries = findChapters(toc.entries, query, values.mode === "ordinal" ? "ordinal" : "chapter");
      if (!entries.length)
        return { fieldErrors: { query: tr(ctx.locale, "missing") } };
      if (entries.length === 1)
        return entries[0].location ? jump(ctx, entries[0].location) : { fieldErrors: { query: tr(ctx.locale, "unavailable") } };
      return { view: chapterResults(ctx, entries) };
    }
  };
  const actions = [];
  const guard = { sessionId: session.sessionId ?? undefined };
  for (const direction of ["back", "forward"]) {
    if (!(direction === "back" ? session.history.canGoBack : session.history.canGoForward))
      continue;
    actions.push({
      id: direction,
      label: tr(ctx.locale, direction),
      icon: direction === "back" ? "arrow-left" : "arrow-right",
      run: async () => {
        await ctx.domains.reading.commands[direction](guard);
        return { close: true };
      }
    });
  }
  return { kind: "blocks", blocks: [
    ...actions.length ? [{ kind: "actions", actions }] : [],
    form,
    { kind: "actions", actions: [
      {
        id: "navigation",
        label: navigationWords(ctx.locale).navigation,
        icon: "list-bullets",
        run: async () => ({ view: await navigationView(ctx) })
      },
      { id: "bookmarks", label: bookmarkCopy(ctx.locale).title, icon: "book-bookmark", run: async () => ({ view: await bookmarksView(ctx) }) }
    ] }
  ] };
}

// src/bookmark-tools.ts
var invalid = () => {
  throw Object.assign(Error("Invalid bookmark tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    invalid();
}
function text2(value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalid();
  return value;
}
function kind(value) {
  if (value !== "location" && value !== "selection")
    return invalid();
  return value;
}
async function locationToken(bookmark) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: bookmark.kind, target: bookmark.target }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `bm1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
var string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
function registerBookmarkTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Jumper requires agent:tools");
  ctx.contributions.agentTools.register({
    name: "list_bookmarks",
    label: "List bookmarks",
    contexts: ["global"],
    description: "List a bounded page of Jumper bookmarks, optionally for an exact bookId and query. Query is a literal substring of any stored JSON key or scalar value (including nested fields), with Unicode lowercase matching, not regex, tokenization or accent folding. Maximum 1024 UTF-8 bytes, no controls; empty means unfiltered. Search runs over the whole collection before pagination. Returns ids and revisions for subsequent approved operations, not source text or raw locators. Keep the same book/query filters and returned cursor when paging. Any collection write invalidates the cursor: restart on stale-cursor. Invalid entries may be explicitly deleted, not opened or renamed.",
    parameters: { type: "object", properties: { bookId: string(), query: { type: "string", maxLength: 1024 }, cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "cursor", "limit", "query"]);
      const query = params.query === undefined ? undefined : bookmarkSearchQuery(params.query);
      if (query === null)
        return invalid();
      const limit = params.limit ?? 10;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20)
        return invalid();
      const page = await bookmarkCollection(ctx).page({
        limit,
        ...query === undefined ? {} : { query },
        ...params.bookId === undefined ? {} : { bookId: text2(params.bookId) },
        ...params.cursor === undefined ? {} : { cursor: text2(params.cursor, 8192) }
      });
      if (page.status === "stale-cursor")
        return page;
      return { status: "ready", nextCursor: page.nextCursor, items: page.items.map((doc) => {
        const bookmark = parseBookmark(doc.data);
        return { id: doc.id, revision: doc.revision, valid: Boolean(bookmark), ...bookmark ? {
          name: bookmark.name,
          kind: bookmark.kind,
          bookId: bookmark.target.bookId,
          bookTitle: bookmark.bookTitle.slice(0, 160),
          bookTitleTruncated: bookmark.bookTitle.length > 160
        } : {} };
      }) };
    }
  });
  ctx.contributions.agentTools.register({
    name: "inspect_bookmark_location",
    label: "Inspect bookmark location",
    contexts: ["global"],
    description: "Inspect the current reading location or readable selection before saving a Jumper bookmark. Returns book metadata and an opaque locationToken, not full source text. Does not save or navigate. Pass the unchanged kind, bookId and token to save_bookmark; that operation refuses a changed position or selection. A source may have session-limited validity.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["location", "selection"] } }, required: ["kind"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["kind"]);
      const bookmark = await captureBookmark(ctx, kind(params.kind));
      return {
        kind: bookmark.kind,
        bookId: bookmark.target.bookId,
        bookTitle: bookmark.bookTitle,
        suggestedName: bookmark.name,
        locationToken: await locationToken(bookmark)
      };
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_bookmark",
    label: "Save bookmark",
    contexts: ["global"],
    approval: "required",
    description: "After host approval, save the current reading location or selection previously inspected with inspect_bookmark_location. Pass its exact kind, bookId and locationToken plus the requested name. Rechecks the target before writing and returns stale-location rather than capturing a different position. Saves only a private Jumper bookmark, not an annotation or reading-history event. Does not navigate. Repeated successful calls may create separate bookmarks.",
    parameters: { type: "object", properties: {
      kind: { type: "string", enum: ["location", "selection"] },
      bookId: string(),
      locationToken: { type: "string", pattern: "^bm1:[a-f0-9]{64}$" },
      name: string(120)
    }, required: ["kind", "bookId", "locationToken", "name"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["kind", "bookId", "locationToken", "name"]);
      const selectedKind = kind(params.kind), bookId = text2(params.bookId), token = text2(params.locationToken, 68), name = bookmarkName(params.name);
      if (!name || !/^bm1:[a-f0-9]{64}$/.test(token))
        return invalid();
      const bookmark = await captureBookmark(ctx, selectedKind);
      if (bookmark.target.bookId !== bookId || await locationToken(bookmark) !== token)
        return { status: "stale-location" };
      const id = crypto.randomUUID(), receipt = await writeBookmark(ctx, id, { ...bookmark, name }, null);
      return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name, bookId };
    }
  });
  ctx.contributions.agentTools.register({
    name: "manage_bookmark",
    label: "Manage bookmark",
    contexts: ["global"],
    approval: "required",
    description: "Open, rename or permanently delete one Jumper bookmark after host approval. First list_bookmarks and pass the exact id and expectedRevision; a changed document returns conflict. Rename requires name; other actions must omit it. Open uses the stored book and content version through shared navigation, rejects removed/stale sources and never guesses a replacement location. Delete removes only this bookmark, not its book or annotations. Invalid entries can only be deleted.",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["open", "rename", "delete"] }, id: string(), expectedRevision: string(), name: string(120) },
      required: ["action", "id", "expectedRevision"],
      additionalProperties: false
    },
    execute: async (params) => {
      fields(params, ["action", "id", "expectedRevision", "name"]);
      const id = text2(params.id), expectedRevision = text2(params.expectedRevision);
      if (typeof params.action !== "string" || !["open", "rename", "delete"].includes(params.action))
        return invalid();
      const name = params.action === "rename" ? bookmarkName(params.name) : null;
      if (params.action === "rename" ? !name : params.name !== undefined)
        return invalid();
      const doc = await bookmarkCollection(ctx).get(id);
      if (!doc)
        return { status: "not-found", id };
      if (doc.revision !== expectedRevision)
        return { status: "conflict", id };
      if (params.action === "delete") {
        const receipt = await removeBookmark(ctx, doc);
        return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
      }
      const bookmark = parseBookmark(doc.data);
      if (!bookmark)
        return { status: "invalid-bookmark", id };
      if (params.action === "rename") {
        const receipt = await writeBookmark(ctx, id, { ...bookmark, name }, expectedRevision);
        return { status: receipt.status === "conflict" ? "conflict" : "renamed", id };
      }
      await openBookmark(ctx, bookmark);
      return { status: "completed", action: "open", id, bookId: bookmark.target.bookId };
    }
  });
}

// src/bookmark-service.ts
async function listBookmarkPage(ctx, input) {
  if (ctx.grants.book.mode !== "book")
    throw Object.assign(Error("A book is required"), { code: "plugin/object-access-denied" });
  const { cursor, limit = 20 } = input;
  const bookId = ctx.grants.book.bookId;
  const page = await ctx.services.storage.collection(BOOKMARKS).page({ bookId, limit, ...cursor === undefined ? {} : { cursor } });
  if (page.status === "stale-cursor")
    return { status: "stale-cursor", items: [], nextCursor: null };
  return { status: "ready", items: page.items.flatMap((doc) => {
    const bookmark = parseBookmark(doc.data);
    return bookmark?.target.bookId === bookId ? [{ id: doc.id, name: bookmark.name, kind: bookmark.kind }] : [];
  }), nextCursor: page.nextCursor };
}

// src/index.ts
var plugin = {
  services: { "bookmark-page": listBookmarkPage },
  activate(ctx) {
    assertCapabilities(ctx);
    registerBookmarkTools(ctx);
    const unavailable = { revision: 0, visible: true, enabled: false };
    const header = ctx.contributions.headerActions.register({
      id: "jumper",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      surface: "reader",
      presentation: "popup",
      view: () => jumperView(ctx)
    });
    const open = ctx.contributions.commands.register({
      id: "open",
      title: "Jumper",
      icon: "magnifying-glass",
      state: unavailable,
      keywords: "jump chapter text search navigation",
      run: async () => ({ view: await jumperView(ctx) })
    });
    ctx.contributions.commands.register({
      id: "bookmarks",
      title: `Jumper: ${bookmarkCopy(ctx.locale).title}`,
      icon: "book-bookmark",
      state: { revision: 0, visible: true, enabled: true },
      keywords: "bookmark saved location passage",
      run: async () => ({ view: await bookmarksView(ctx) })
    });
    const history = ["back", "forward"].map((direction) => ({
      direction,
      registration: ctx.contributions.commands.register({
        id: direction,
        title: `Jumper: ${tr(ctx.locale, direction)}`,
        state: unavailable,
        icon: direction === "back" ? "arrow-left" : "arrow-right",
        defaultShortcut: { key: direction === "back" ? "ArrowLeft" : "ArrowRight", alt: true },
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          await ctx.domains.reading.commands[direction]({ sessionId: session.sessionId ?? undefined });
        }
      })
    }));
    ctx.domains.reading.events.observeSession(async (session, delivery) => {
      if (delivery?.reaction?.status === "cycle")
        return;
      const state = { revision: session.revision + 1, visible: true, enabled: session.status === "ready" };
      await Promise.all([ctx.withEvent(delivery, header).updateState(state), ctx.withEvent(delivery, open).updateState(state), ...history.map(({ direction, registration }) => ctx.withEvent(delivery, registration).updateState({ ...state, enabled: state.enabled && (direction === "back" ? session.history.canGoBack : session.history.canGoForward) }))]);
    }, { ruleId: "reader-action-state" });
  }
};
var src_default = plugin;
export {
  src_default as default
};
