const locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"] as const;
const strings = {
  searchQuery: ["Search", "搜索", "搜尋", "検索", "Поиск", "Recherche", "Suche", "Búsqueda"],
  invalidSearch: ["Search is too long or contains control characters.", "搜索内容过长或含控制字符。", "搜尋內容過長或含控制字元。", "検索文字列が長すぎるか、制御文字が含まれています。", "Запрос слишком длинный или содержит управляющие символы.", "La recherche est trop longue ou contient des caractères de contrôle.", "Die Suche ist zu lang oder enthält Steuerzeichen.", "La búsqueda es demasiado larga o contiene caracteres de control."],
  clearSearch: ["Clear search", "清除搜索", "清除搜尋", "検索をクリア", "Очистить поиск", "Effacer la recherche", "Suche löschen", "Borrar búsqueda"],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  cancel: ["Cancel", "取消", "取消", "キャンセル", "Отмена", "Annuler", "Abbrechen", "Cancelar"],
  cancelled: ["Search cancelled.", "搜索已取消。", "搜尋已取消。", "検索をキャンセルしました。", "Поиск отменён.", "Recherche annulée.", "Suche abgebrochen.", "Búsqueda cancelada."],
  mode: ["Jump to", "跳转到", "跳轉到", "移動先", "Перейти к", "Aller à", "Springen zu", "Ir a"],
  chapter: ["Chapter", "章节", "章節", "章", "Глава", "Chapitre", "Kapitel", "Capítulo"],
  text: ["Passage", "正文", "正文", "本文", "Фрагмент", "Passage", "Textstelle", "Pasaje"],
  page: ["Page", "页码", "頁碼", "ページ", "Страница", "Page", "Seite", "Página"],
  queryChapter: ["Chapter number or title", "章节号或标题", "章節號或標題", "章番号または見出し", "Номер или название главы", "Numéro ou titre du chapitre", "Kapitelnummer oder Titel", "Número o título del capítulo"],
  queryText: ["Words to find in the book", "要在书中查找的文字", "要在書中查找的文字", "本の中で探す語句", "Слова для поиска в книге", "Mots à trouver dans le livre", "Wörter, die im Buch gesucht werden", "Palabras que buscar en el libro"],
  queryPage: ["Printed page number, e.g. 42 or xiv", "原书页码，如 42 或 xiv", "原書頁碼，如 42 或 xiv", "本の印刷ページ番号（例：42、xiv）", "Номер страницы в книге, например 42 или xiv", "Numéro de page imprimé, ex. 42 ou xiv", "Gedruckte Seitenzahl, z. B. 42 oder xiv", "Número de página impreso, p. ej. 42 o xiv"],
  search: ["Go", "前往", "前往", "移動", "Перейти", "Aller", "Los", "Ir"],
  back: ["Go back", "后退", "後退", "戻る", "Назад", "Reculer", "Zurück", "Atrás"],
  forward: ["Go forward", "前进", "前進", "進む", "Вперёд", "Avancer", "Vorwärts", "Adelante"],
  matchCase: ["Match case", "区分大小写", "區分大小寫", "大文字と小文字を区別", "Учитывать регистр", "Respecter la casse", "Groß-/Kleinschreibung", "Distinguir mayúsculas"],
  wholeWords: ["Whole words", "全词匹配", "全詞匹配", "単語全体", "Слова целиком", "Mots entiers", "Ganze Wörter", "Palabras completas"],
  invalid: ["Enter 1 to 500 characters.", "请输入 1 至 500 个字符。", "請輸入 1 至 500 個字元。", "1〜500文字を入力してください。", "Введите от 1 до 500 символов.", "Saisissez de 1 à 500 caractères.", "1 bis 500 Zeichen eingeben.", "Introduce entre 1 y 500 caracteres."],
  invalidPage: ["Enter a page number of 1 to 300 characters.", "请输入 1 至 300 个字符的页码。", "請輸入 1 至 300 個字元的頁碼。", "1〜300文字のページ番号を入力してください。", "Введите номер страницы длиной от 1 до 300 символов.", "Saisissez un numéro de page de 1 à 300 caractères.", "Seitenzahl mit 1 bis 300 Zeichen eingeben.", "Introduce un número de página de 1 a 300 caracteres."],
  missing: ["Chapter not found.", "该章节不存在。", "該章節不存在。", "章が見つかりません。", "Глава не найдена.", "Chapitre introuvable.", "Kapitel nicht gefunden.", "Capítulo no encontrado."],
  missingPage: ["No page with that number.", "没有这个页码。", "沒有這個頁碼。", "そのページ番号はありません。", "Страницы с таким номером нет.", "Aucune page avec ce numéro.", "Keine Seite mit dieser Nummer.", "No hay ninguna página con ese número."],
  pagesUnavailable: ["This book has no printed page numbers.", "这本书没有原书页码。", "這本書沒有原書頁碼。", "この本には印刷ページ番号がありません。", "В этой книге нет номеров страниц.", "Ce livre n’a pas de numéros de page imprimés.", "Dieses Buch hat keine gedruckten Seitenzahlen.", "Este libro no tiene números de página impresos."],
  unavailable: ["This heading has no reading location.", "此目录标题没有可跳转的位置。", "此目錄標題沒有可跳轉的位置。", "この見出しには移動先がありません。", "У этого заголовка нет позиции для перехода.", "Ce titre n'a pas de destination.", "Diese Überschrift hat kein Sprungziel.", "Este título no tiene destino."],
  chooseTarget: ["Several matches. Pick one.", "有多个匹配，请选择一个。", "有多個符合項目，請選擇一個。", "複数の候補があります。1つ選んでください。", "Несколько совпадений. Выберите одно.", "Plusieurs résultats. Choisissez-en un.", "Mehrere Treffer. Wählen Sie einen.", "Varias coincidencias. Elige una."],
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
