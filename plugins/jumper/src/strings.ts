const locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"] as const;
const strings = {
  searchQuery: ["Search", "搜索", "搜尋", "検索", "Поиск", "Recherche", "Suche", "Búsqueda"],
  invalidSearch: ["Search is too long or contains control characters.", "搜索内容过长或含控制字符。", "搜尋內容過長或含控制字元。", "検索文字列が長すぎるか、制御文字が含まれています。", "Запрос слишком длинный или содержит управляющие символы.", "La recherche est trop longue ou contient des caractères de contrôle.", "Die Suche ist zu lang oder enthält Steuerzeichen.", "La búsqueda es demasiado larga o contiene caracteres de control."],
  clearSearch: ["Clear search", "清除搜索", "清除搜尋", "検索をクリア", "Очистить поиск", "Effacer la recherche", "Suche löschen", "Borrar búsqueda"],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: ["Search cancelled.", "搜索已取消。", "搜尋已取消。", "検索をキャンセルしました。", "Поиск отменён.", "Recherche annulée.", "Suche abgebrochen.", "Búsqueda cancelada."],
  goTo: ["Chapter, page or words to find", "章节、页码或要查找的文字", "章節、頁碼或要查找的文字", "章、ページ、または探す語句", "Глава, страница или слова для поиска", "Chapitre, page ou mots à trouver", "Kapitel, Seite oder gesuchte Wörter", "Capítulo, página o palabras que buscar"],
  current: ["Current", "当前", "目前", "現在地", "Текущая", "Actuelle", "Aktuell", "Actual"],
  pageTitle: ["Page {n}", "第 {n} 页", "第 {n} 頁", "{n} ページ", "Страница {n}", "Page {n}", "Seite {n}", "Página {n}"],
  searchText: ["Search the text for “{q}”", "在正文中搜索“{q}”", "在正文中搜尋「{q}」", "本文から「{q}」を検索", "Искать «{q}» в тексте", "Rechercher « {q} » dans le texte", "„{q}“ im Text suchen", "Buscar «{q}» en el texto"],
  noToc: ["This book has no table of contents.", "这本书没有目录。", "這本書沒有目錄。", "この本には目次がありません。", "В этой книге нет оглавления.", "Ce livre n’a pas de table des matières.", "Dieses Buch hat kein Inhaltsverzeichnis.", "Este libro no tiene índice."],
  search: ["Go", "前往", "前往", "移動", "Перейти", "Aller", "Los", "Ir"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  unavailable: ["This heading has no reading location.", "此目录标题没有可跳转的位置。", "此目錄標題沒有可跳轉的位置。", "この見出しには移動先がありません。", "У этого заголовка нет позиции для перехода.", "Ce titre n'a pas de destination.", "Diese Überschrift hat kein Sprungziel.", "Este título no tiene destino."],
  noBook: ["Open a book to jump around in it.", "打开一本书后即可在书中跳转。", "開啟一本書後即可在書中跳轉。", "本を開くと、その中を移動できます。", "Откройте книгу, чтобы перемещаться по ней.", "Ouvrez un livre pour vous y déplacer.", "Öffnen Sie ein Buch, um darin zu springen.", "Abre un libro para moverte por él."],
  noHits: ["No matches.", "没有匹配结果。", "沒有符合的結果。", "一致する結果はありません。", "Совпадений нет.", "Aucun résultat.", "Keine Treffer.", "Sin coincidencias."],
  timedOut: ["Search timed out.", "搜索超时。", "搜尋逾時。", "検索がタイムアウトしました。", "Поиск превысил время ожидания.", "La recherche a expiré.", "Die Suche hat das Zeitlimit überschritten.", "La búsqueda agotó el tiempo."],
  scanLimit: ["Search stopped at its section limit.", "搜索已达到分节上限。", "搜尋已達到分節上限。", "セクション上限で検索を停止しました。", "Поиск остановлен на лимите разделов.", "Recherche arrêtée à la limite de sections.", "Suche am Abschnittslimit angehalten.", "Búsqueda detenida en el límite de secciones."],
  resultLimit: ["Search stopped at its result limit.", "搜索已达到结果上限。", "搜尋已達到結果上限。", "結果上限で検索を停止しました。", "Поиск остановлен на лимите результатов.", "Recherche arrêtée à la limite de résultats.", "Suche am Ergebnislimit angehalten.", "Búsqueda detenida en el límite de resultados."],
  stale: ["The book changed; search again.", "书籍内容已变化，请重新搜索。", "書籍內容已變更，請重新搜尋。", "本の内容が変わりました。もう一度検索してください。", "Книга изменилась; выполните поиск снова.", "Le livre a changé ; relancez la recherche.", "Das Buch wurde geändert; suche erneut.", "El libro cambió; vuelve a buscar."],
  textless: ["This book has no searchable text.", "这本书没有可搜索的文本。", "這本書沒有可搜尋的文字。", "この本には検索可能なテキストがありません。", "В книге нет текста для поиска.", "Ce livre ne contient aucun texte consultable.", "Dieses Buch enthält keinen durchsuchbaren Text.", "Este libro no tiene texto que buscar."],
  unsupported: ["Text search is unavailable for some or all sections.", "部分或全部内容暂不支持文本搜索。", "部分或全部內容暫不支援文字搜尋。", "一部または全部の内容でテキスト検索が利用できません。", "Поиск недоступен для части или всей книги.", "La recherche est indisponible pour tout ou partie du livre.", "Die Textsuche ist für Teile oder das gesamte Buch nicht verfügbar.", "La búsqueda no está disponible en parte o todo el libro."],
} satisfies Record<string, readonly [string, string, string, string, string, string, string, string]>;

export function tr(locale: string, key: keyof typeof strings): string {
  const exact = locales.findIndex(value => value.toLowerCase() === locale.toLowerCase());
  const base = locales.findIndex(value => value === locale.split("-")[0]);
  return strings[key][exact >= 0 ? exact : base >= 0 ? base : 0];
}
