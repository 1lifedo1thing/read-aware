// src/strings.ts
var locales = ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"];
var labels = {
  contentSource: ["Content source", "正文来源", "正文來源", "本文の提供元", "Источник текста", "Source du contenu", "Inhaltsquelle", "Origen del contenido"],
  sourceFile: ["Book file", "书籍文件", "書籍檔案", "書籍ファイル", "Файл книги", "Fichier du livre", "Buchdatei", "Archivo del libro"],
  sourcePlugin: ["Plugin", "插件", "外掛", "プラグイン", "Плагин", "Plugin", "Plugin", "Complemento"],
  sourceLocal: ["Stored locally", "已保存在本机", "已儲存在本機", "端末に保存済み", "Сохранено локально", "Enregistré localement", "Lokal gespeichert", "Guardado localmente"],
  sourceMissing: ["Source missing", "来源缺失", "來源缺失", "提供元がありません", "Источник отсутствует", "Source absente", "Quelle fehlt", "Falta el origen"],
  sourceRegistered: ["Provider registered", "提供者已注册", "提供者已註冊", "提供元は登録済み", "Поставщик зарегистрирован", "Fournisseur enregistré", "Anbieter registriert", "Proveedor registrado"],
  sourceUnavailable: ["Provider unavailable", "提供者不可用", "提供者無法使用", "提供元を利用できません", "Поставщик недоступен", "Fournisseur indisponible", "Anbieter nicht verfügbar", "Proveedor no disponible"],
  bookUpdates: ["Book updates", "书籍更新", "書籍更新", "本の更新", "Обновления книг", "Mises à jour des livres", "Buchänderungen", "Actualizaciones de libros"],
  updatesNeedBook: ["Open a book to check its updates.", "请先打开获授权的书籍。", "請先開啟獲授權的書籍。", "許可された本を開いてください。", "Откройте разрешённую книгу.", "Ouvrez un livre autorisé.", "Öffnen Sie ein freigegebenes Buch.", "Abre un libro autorizado."],
  updatesBaseline: ["Tracking started. Current books (up to 20) are shown below.", "已开始记录更新。下方显示当前书籍，最多 20 本。", "已開始記錄更新。下方顯示目前書籍，最多 20 本。", "更新の記録を開始しました。現在の本を最大20冊表示します。", "Отслеживание начато. Ниже до 20 текущих книг.", "Suivi démarré. Jusqu’à 20 livres actuels sont affichés.", "Erfassung gestartet. Unten stehen bis zu 20 aktuelle Bücher.", "Seguimiento iniciado. Se muestran hasta 20 libros actuales."],
  updatesReset: ["Older updates expired. Current books have been reloaded (up to 20).", "旧更新已过期，已重新载入当前书籍，最多 20 本。", "舊更新已過期，已重新載入目前書籍，最多 20 本。", "古い更新は期限切れです。現在の本を最大20冊再読み込みしました。", "Старые обновления истекли. Перезагружено до 20 текущих книг.", "Les anciennes mises à jour ont expiré. Jusqu’à 20 livres ont été rechargés.", "Ältere Änderungen sind abgelaufen. Bis zu 20 aktuelle Bücher wurden neu geladen.", "Las actualizaciones antiguas caducaron. Se recargaron hasta 20 libros actuales."],
  updatesNote: ["Saved update page: current book details, not a complete edit history.", "已保存的更新页：展示书籍当前状态，不是完整编辑历史。", "已儲存的更新頁：展示書籍目前狀態，不是完整編輯歷史。", "保存済みの更新ページです。編集履歴ではなく現在の本の状態を表示します。", "Сохранённая страница: текущее состояние книг, не полная история правок.", "Page enregistrée : état actuel des livres, pas un historique complet.", "Gespeicherte Seite: aktueller Buchstand, kein vollständiger Änderungsverlauf.", "Página guardada: estado actual, no un historial completo de ediciones."],
  updatesShelf: ["Library organization updated", "书库组织已更新", "書庫組織已更新", "ライブラリ構成が更新されました", "Структура библиотеки обновлена", "Organisation de la bibliothèque mise à jour", "Bibliotheksstruktur aktualisiert", "Organización de biblioteca actualizada"],
  updatesRemoved: ["Book removed or no longer available", "书籍已移除或不再可用", "書籍已移除或不再可用", "本が削除されたか利用できません", "Книга удалена или недоступна", "Livre supprimé ou indisponible", "Buch entfernt oder nicht mehr verfügbar", "Libro eliminado o no disponible"],
  updatesMore: ["More updates", "更多更新", "更多更新", "続きの更新", "Ещё обновления", "Autres mises à jour", "Weitere Änderungen", "Más actualizaciones"],
  updatesCheck: ["Check updates", "检查更新", "檢查更新", "更新を確認", "Проверить обновления", "Vérifier les mises à jour", "Änderungen prüfen", "Comprobar actualizaciones"],
  durableJobs: ["Saved tasks", "持久任务", "持久任務", "保存済みタスク", "Сохранённые задачи", "Tâches enregistrées", "Gespeicherte Aufgaben", "Tareas guardadas"],
  preparePage: ["Prepare this page in background", "后台准备本页书籍", "背景準備本頁書籍", "このページの本を準備", "Подготовить книги страницы", "Préparer les livres de cette page", "Bücher dieser Seite vorbereiten", "Preparar los libros de esta página"],
  jobAttention: ["Needs review", "需要核对", "需要核對", "確認が必要", "Требует проверки", "À vérifier", "Prüfung nötig", "Requiere revisión"],
  jumperBookmarks: ["Jumper bookmarks", "Jumper 书签", "Jumper 書籤", "Jumper のブックマーク", "Закладки Jumper", "Signets Jumper", "Jumper-Lesezeichen", "Marcadores de Jumper"],
  jumperUnavailable: ["Enable Jumper and grant both plugins access to this book to read its bookmarks.", "请启用 Jumper，并允许两个插件访问本书，以读取书签。", "請啟用 Jumper，並允許兩個外掛存取本書，以讀取書籤。", "Jumper を有効にして、両方のプラグインにこの本へのアクセスを許可してください。", "Включите Jumper и разрешите обоим плагинам доступ к этой книге.", "Activez Jumper et autorisez les deux extensions à accéder à ce livre.", "Aktiviere Jumper und erlaube beiden Plugins den Zugriff auf dieses Buch.", "Activa Jumper y permite a ambos complementos acceder a este libro."],
  jumperChanged: ["The bookmarks or Jumper changed. Refresh to read the current list.", "书签或 Jumper 已发生变化，请刷新列表。", "書籤或 Jumper 已變更，請重新整理清單。", "ブックマークまたは Jumper が変わりました。更新してください。", "Закладки или Jumper изменились. Обновите список.", "Les signets ou Jumper ont changé. Actualisez la liste.", "Die Lesezeichen oder Jumper wurden geändert. Aktualisiere die Liste.", "Los marcadores o Jumper han cambiado. Actualiza la lista."],
  jumperEmpty: ["No bookmarks on this page.", "本页没有书签。", "本頁沒有書籤。", "このページにブックマークはありません。", "На этой странице нет закладок.", "Aucun signet sur cette page.", "Keine Lesezeichen auf dieser Seite.", "No hay marcadores en esta página."],
  preparationPrerequisites: ["Text preparation prerequisites", "正文准备条件", "正文準備條件", "本文準備の条件", "Условия подготовки текста", "Conditions de préparation du texte", "Voraussetzungen der Textaufbereitung", "Requisitos de preparación del texto"],
  rebuildPrerequisites: ["Text rebuild prerequisites", "正文重建条件", "正文重建條件", "本文再構築の条件", "Условия перестроения текста", "Conditions de reconstruction du texte", "Voraussetzungen des Textneuaufbaus", "Requisitos de reconstrucción del texto"],
  preparationPrerequisitesNote: ["Checks the source and request capacity without loading content or downloading. Unknown conditions are verified when you run the operation.", "检查书籍源和任务容量，不加载正文或下载文件。未知条件会在执行操作时确认。", "檢查書籍來源與工作容量，不載入正文或下載檔案。未知條件會在執行操作時確認。", "本文の読み込みやダウンロードをせずに、書籍の元データとタスク容量を確認します。不明な条件は操作時に確認されます。", "Проверяет источник и ёмкость задач без загрузки содержимого. Неизвестные условия проверяются при выполнении.", "Vérifie la source et la capacité des tâches sans charger de contenu ni télécharger. Les conditions inconnues sont vérifiées à l’exécution.", "Prüft Quelle und Auftragskapazität ohne Inhalte zu laden oder herunterzuladen. Unbekannte Bedingungen werden bei der Ausführung geprüft.", "Comprueba la fuente y la capacidad de tareas sin cargar contenido ni descargar. Las condiciones desconocidas se verifican al ejecutar."],
  sourceProvider: ["Content or download provider", "内容或下载提供者", "內容或下載提供者", "コンテンツ・ダウンロード提供元", "Провайдер содержимого или загрузки", "Fournisseur de contenu ou de téléchargement", "Inhalts- oder Downloadanbieter", "Proveedor de contenido o descarga"],
  availability_capacity: ["Request capacity", "任务容量", "工作容量", "タスク容量", "Ёмкость задач", "Capacité des tâches", "Auftragskapazität", "Capacidad de tareas"],
  readingAvailability: ["Reading prerequisites", "阅读操作条件", "閱讀操作條件", "読書操作の利用条件", "Условия чтения", "Conditions de lecture", "Lesevoraussetzungen", "Requisitos de lectura"],
  readingAvailabilityNote: ["Checks this reading session. Voice presence and mode registration do not verify audio output or provider execution.", "检查本次阅读会话。语音可用或模式已注册，不代表已经验证播放或提供者执行成功。", "檢查本次閱讀工作階段。語音可用或模式已註冊，不代表已驗證播放或提供者執行成功。", "現在の読書セッションを確認します。音声やモードの存在は、再生や実行の成功を保証しません。", "Проверяет текущий сеанс. Наличие голоса или режима не подтверждает успешное воспроизведение или выполнение.", "Vérifie cette session. La présence d’une voix ou d’un mode ne confirme pas la réussite de la lecture ou du fournisseur.", "Prüft diese Lesesitzung. Vorhandene Stimmen oder Modi bestätigen noch keine erfolgreiche Wiedergabe oder Ausführung.", "Comprueba esta sesión. La presencia de voz o modo no confirma la reproducción ni la ejecución del proveedor."],
  enableReadingMode: ["Enable reading mode", "启用阅读模式", "啟用閱讀模式", "読書モードを有効化", "Включить режим чтения", "Activer le mode de lecture", "Lesemodus aktivieren", "Activar modo de lectura"],
  startReadingAloud: ["Start read aloud", "开始朗读", "開始朗讀", "読み上げ開始", "Начать чтение вслух", "Démarrer la lecture vocale", "Vorlesen starten", "Iniciar lectura en voz alta"],
  stopReadingAloud: ["Stop read aloud", "停止朗读", "停止朗讀", "読み上げ停止", "Остановить чтение вслух", "Arrêter la lecture vocale", "Vorlesen stoppen", "Detener lectura en voz alta"],
  readingModeCondition: ["Active reading mode", "阅读模式已启用", "閱讀模式已啟用", "有効な読書モード", "Активный режим чтения", "Mode de lecture actif", "Aktiver Lesemodus", "Modo de lectura activo"],
  readingUnitCondition: ["Reading input", "阅读输入", "閱讀輸入", "読書の入力", "Входные данные чтения", "Entrée de lecture", "Leseeingabe", "Entrada de lectura"],
  readingProviderCondition: ["Reading provider", "阅读提供者", "閱讀提供者", "読書機能の提供元", "Провайдер чтения", "Fournisseur de lecture", "Leseanbieter", "Proveedor de lectura"],
  availability_object: ["Target book and session", "目标书籍与会话", "目標書籍與工作階段", "対象の本とセッション", "Целевая книга и сеанс", "Livre et session ciblés", "Zielbuch und Sitzung", "Libro y sesión de destino"],
  availability_reader: ["Reader readiness", "阅读器就绪状态", "閱讀器就緒狀態", "リーダーの準備状態", "Готовность ридера", "Disponibilité du lecteur", "Bereitschaft des Readers", "Disponibilidad del lector"],
  inferenceAvailability: ["Image AI prerequisites", "图像 AI 使用条件", "影像 AI 使用條件", "画像AIの利用条件", "Условия для ИИ изображений", "Conditions pour l’IA d’images", "Voraussetzungen für Bild-KI", "Requisitos de IA de imágenes"],
  availabilityNote: ["Checks the saved Smart-model configuration for image input. This does not send a request or verify the remote service.", "检查已保存的 Smart 模型是否具备图像输入条件。不会发送请求，也不验证远端服务。", "檢查已儲存的 Smart 模型是否具備影像輸入條件。不會傳送請求，也不驗證遠端服務。", "保存済みSmartモデルの画像入力条件を確認します。リクエスト送信や外部サービスの検証は行いません。", "Проверяет настройки Smart для изображений. Не отправляет запрос и не проверяет удалённый сервис.", "Vérifie la configuration Smart enregistrée pour les images, sans envoyer de requête ni tester le service distant.", "Prüft die gespeicherte Smart-Konfiguration für Bilder, ohne Anfrage oder Test des entfernten Dienstes.", "Comprueba la configuración Smart guardada para imágenes, sin enviar solicitudes ni probar el servicio remoto."],
  availability_permission: ["Permission", "权限", "權限", "権限", "Разрешение", "Autorisation", "Berechtigung", "Permiso"],
  availability_account: ["Account credentials", "账户凭据", "帳戶憑證", "アカウント認証情報", "Данные учётной записи", "Identifiants du compte", "Kontozugangsdaten", "Credenciales de la cuenta"],
  availability_model: ["Model selection", "模型选择", "模型選擇", "モデル選択", "Выбор модели", "Sélection du modèle", "Modellauswahl", "Selección del modelo"],
  availability_endpoint: ["Connection address", "连接地址", "連線位址", "接続先", "Адрес подключения", "Adresse de connexion", "Verbindungsadresse", "Dirección de conexión"],
  availability_provider: ["Remote service", "远端服务", "遠端服務", "外部サービス", "Удалённый сервис", "Service distant", "Entfernter Dienst", "Servicio remoto"],
  availability_input: ["Image input", "图像输入", "影像輸入", "画像入力", "Ввод изображений", "Entrée d’images", "Bildeingabe", "Entrada de imágenes"],
  availability_satisfied: ["Configured", "条件满足", "條件符合", "設定済み", "Настроено", "Configuré", "Konfiguriert", "Configurado"],
  availability_unconfigured: ["Not configured", "尚未配置", "尚未設定", "未設定", "Не настроено", "Non configuré", "Nicht konfiguriert", "Sin configurar"],
  availability_unavailable: ["Unavailable", "不可用", "無法使用", "利用不可", "Недоступно", "Indisponible", "Nicht verfügbar", "No disponible"],
  availability_unknown: ["Unknown", "未知", "未知", "不明", "Неизвестно", "Inconnu", "Unbekannt", "Desconocido"],
  inferenceHistory: ["AI request history", "AI 请求历史", "AI 請求歷史", "AIリクエスト履歴", "История запросов ИИ", "Historique des requêtes IA", "KI-Anfrageverlauf", "Historial de solicitudes IA"],
  noInferenceHistory: ["No saved AI requests", "没有已保存的 AI 请求", "沒有已儲存的 AI 請求", "保存済みAIリクエストはありません", "Нет сохранённых запросов ИИ", "Aucune requête IA enregistrée", "Keine gespeicherten KI-Anfragen", "No hay solicitudes IA guardadas"],
  requestTimedOut: ["Timed out", "已超时", "已逾時", "時間切れ", "Время истекло", "Délai dépassé", "Zeitüberschreitung", "Tiempo agotado"],
  inferenceSettlement: ["Provider response settled", "提供者响应已结束", "提供者回應已結束", "提供元の応答終了", "Ответ провайдера завершён", "Réponse du fournisseur terminée", "Anbieterantwort abgeschlossen", "Respuesta del proveedor finalizada"],
  inferenceModel: ["Model", "模型", "模型", "モデル", "Модель", "Modèle", "Modell", "Modelo"],
  inferenceInput: ["Input tokens", "输入 token", "輸入 token", "入力トークン", "Входные токены", "Tokens d’entrée", "Eingabetokens", "Tokens de entrada"],
  inferenceOutput: ["Output tokens", "输出 token", "輸出 token", "出力トークン", "Выходные токены", "Tokens de sortie", "Ausgabetokens", "Tokens de salida"],
  inferenceCost: ["Estimated cost (USD)", "估算费用（美元）", "估算費用（美元）", "推定費用（USD）", "Оценка стоимости (USD)", "Coût estimé (USD)", "Geschätzte Kosten (USD)", "Coste estimado (USD)"],
  changeReason: ["Latest update", "最近更新", "最近更新", "最新の更新", "Последнее обновление", "Dernière mise à jour", "Letzte Änderung", "Última actualización"],
  changeOrigin: ["Update source", "更新来源", "更新來源", "更新元", "Источник обновления", "Source de la mise à jour", "Quelle der Änderung", "Origen de actualización"],
  originHost: ["Host feedback", "宿主反馈", "宿主回饋", "ホストの通知", "Уведомление приложения", "Retour de l’application", "Rückmeldung der App", "Respuesta de la aplicación"],
  originUser: ["Your command", "你的操作", "你的操作", "あなたの操作", "Ваша команда", "Votre commande", "Deine Aktion", "Tu acción"],
  originAgent: ["Agent command", "Agent 操作", "Agent 操作", "Agent の操作", "Команда Agent", "Commande Agent", "Agent-Aktion", "Acción del Agent"],
  originPlugin: ["Plugin", "插件", "外掛", "プラグイン", "Плагин", "Extension", "Plugin", "Complemento"],
  changeLifecycle: ["Session lifecycle", "会话状态变化", "工作階段狀態變化", "セッション状態の変更", "Изменение состояния сеанса", "État de la session", "Sitzungsstatus geändert", "Cambio de estado de sesión"],
  changeNavigation: ["Navigation completed", "导航已完成", "導覽已完成", "移動完了", "Переход завершён", "Navigation terminée", "Navigation abgeschlossen", "Navegación completada"],
  changeSelection: ["Selection changed", "选区变化", "選取範圍變化", "選択範囲の変更", "Изменение выделения", "Sélection modifiée", "Auswahl geändert", "Selección modificada"],
  changeControls: ["Reader controls changed", "阅读控件变化", "閱讀控制項變化", "読書コントロールの変更", "Изменение управления чтением", "Commandes de lecture modifiées", "Lesesteuerung geändert", "Controles de lectura modificados"],
  changeMode: ["Reading mode changed", "阅读模式变化", "閱讀模式變化", "読書モードの変更", "Изменение режима чтения", "Mode de lecture modifié", "Lesemodus geändert", "Modo de lectura modificado"],
  changePlayback: ["Playback changed", "播放状态变化", "播放狀態變化", "再生状態の変更", "Изменение воспроизведения", "Lecture audio modifiée", "Wiedergabe geändert", "Reproducción modificada"],
  historySaved: ["Milestone saved", "节点已保存", "節點已儲存", "進行状況を保存済み", "Этап сохранён", "Étape enregistrée", "Zwischenstand gespeichert", "Etapa guardada"],
  historyPending: ["Saving history", "正在保存历史", "正在儲存歷史", "履歴を保存中", "Сохранение истории", "Enregistrement de l'historique", "Verlauf wird gespeichert", "Guardando historial"],
  historyFailed: ["History save failed; reopen history to retry", "历史保存失败，重新打开历史可重试", "歷史儲存失敗，重新開啟歷史可重試", "履歴の保存に失敗。履歴を開き直して再試行", "История не сохранена; откройте её снова", "Échec de sauvegarde ; rouvrez l'historique", "Speichern fehlgeschlagen; Verlauf erneut öffnen", "No se guardó; vuelve a abrir el historial"],
  taskHistory: ["Saved request history", "已保存的请求历史", "已儲存的請求歷史", "保存済みリクエスト履歴", "Сохранённая история запросов", "Historique enregistré", "Gespeicherter Anfrageverlauf", "Historial de solicitudes guardado"],
  taskInterrupted: ["Interrupted in an earlier session", "已在先前会话中断", "已於先前工作階段中斷", "以前のセッションで中断", "Прервано в предыдущем сеансе", "Interrompue dans une session précédente", "In früherer Sitzung unterbrochen", "Interrumpida en una sesión anterior"],
  recordedAt: ["Recorded at", "记录时间", "記錄時間", "記録日時", "Время записи", "Enregistré le", "Aufgezeichnet am", "Registrado el"],
  noHistory: ["No saved requests for this book", "本书没有已保存的请求", "本書沒有已儲存的請求", "この本の保存済みリクエストはありません", "Нет сохранённых запросов для этой книги", "Aucune requête enregistrée pour ce livre", "Keine gespeicherten Anfragen für dieses Buch", "No hay solicitudes guardadas para este libro"],
  deadline: ["Deadline", "截止时间", "截止時間", "期限", "Крайний срок", "Échéance", "Frist", "Fecha límite"],
  taskTimeout: ["Time limit reached; saved checkpoints remain", "已到时间上限，已保存的检查点保留", "已達時間上限，保留已儲存的檢查點", "制限時間に到達。チェックポイントは保持", "Время истекло; контрольные точки сохранены", "Limite atteinte ; points de reprise conservés", "Zeitlimit erreicht; Zwischenstände bleiben erhalten", "Límite alcanzado; se conservan los puntos guardados"],
  timedPrepare: ["Prepare with time limit", "设置时限并准备", "設定時限並準備", "制限時間を指定して準備", "Подготовить с лимитом времени", "Préparer avec une limite de temps", "Mit Zeitlimit aufbereiten", "Preparar con límite de tiempo"],
  timeLimit: ["Time limit (1–120 minutes)", "时限（1–120 分钟）", "時限（1–120 分鐘）", "制限時間（1～120分）", "Лимит (1–120 минут)", "Limite (1–120 minutes)", "Zeitlimit (1–120 Minuten)", "Límite (1–120 minutos)"],
  timeLimitNote: ["Includes waiting and pause. Saved checkpoints are kept.", "包含等待和暂停时间，保留已保存的检查点。", "包含等待及暫停時間，保留已儲存的檢查點。", "待機・一時停止を含みます。保存済みチェックポイントは保持されます。", "Включает ожидание и паузу. Контрольные точки сохраняются.", "Inclut l'attente et la pause. Les points de reprise sont conservés.", "Einschließlich Warten und Pause. Zwischenstände bleiben erhalten.", "Incluye espera y pausa. Se conservan los puntos guardados."],
  activityState: ["Activity", "活动状态", "活動狀態", "活動状態", "Активность", "Activité", "Aktivität", "Actividad"],
  readerActivity: ["Reading activity", "阅读活动", "閱讀活動", "読書アクティビティ", "Активность чтения", "Activité de lecture", "Leseaktivität", "Actividad de lectura"],
  readerIdle: ["No recent render or movement", "近期没有绘制或位置变化", "近期沒有繪製或位置變化", "最近の描画・移動なし", "Недавних отрисовок или перемещений нет", "Aucun rendu ni déplacement récent", "Kein kürzliches Rendern oder Bewegen", "Sin renderizado ni movimiento reciente"],
  activitySource: ["Last activity", "最近活动", "最近活動", "直近の動作", "Последняя активность", "Dernière activité", "Letzte Aktivität", "Última actividad"],
  renderActivity: ["Page rendering", "页面绘制", "頁面繪製", "ページ描画", "Отрисовка страницы", "Rendu de page", "Seitenrendering", "Renderizado de página"],
  relocateActivity: ["Reading position changed", "阅读位置变化", "閱讀位置變化", "読書位置の変更", "Изменение позиции чтения", "Position de lecture modifiée", "Leseposition geändert", "Cambio de posición de lectura"],
  priority: ["Priority", "优先级", "優先順序", "優先度", "Приоритет", "Priorité", "Priorität", "Prioridad"],
  normalPriority: ["Normal priority", "普通优先级", "一般優先順序", "通常優先度", "Обычный приоритет", "Priorité normale", "Normale Priorität", "Prioridad normal"],
  backgroundPriority: ["Background priority", "后台优先级", "背景優先順序", "バックグラウンド優先度", "Фоновый приоритет", "Priorité en arrière-plan", "Hintergrundpriorität", "Prioridad de fondo"],
  waiting: ["Waiting", "等待原因", "等待原因", "待機理由", "Ожидание", "Attente", "Wartegrund", "En espera"],
  readerWait: ["Yielding to reading", "正在为阅读让路", "正在為閱讀讓路", "読書を優先しています", "Уступает чтению", "Priorité à la lecture", "Lesen hat Vorrang", "Cediendo a la lectura"],
  queueWait: ["Waiting for an extraction slot", "等待抽取空位", "等待擷取空位", "抽出枠を待機中", "Ожидание очереди извлечения", "En attente d'une place d'extraction", "Wartet auf Extraktionsplatz", "Esperando turno de extracción"],
  task_paused: ["Paused", "已暂停", "已暫停", "一時停止中", "Приостановлено", "En pause", "Pausiert", "En pausa"],
  pauseRequest: ["Pause request", "暂停此请求", "暫停此請求", "リクエストを一時停止", "Приостановить запрос", "Mettre la requête en pause", "Anfrage pausieren", "Pausar solicitud"],
  resumeRequest: ["Resume request", "恢复此请求", "恢復此請求", "リクエストを再開", "Возобновить запрос", "Reprendre la requête", "Anfrage fortsetzen", "Reanudar solicitud"],
  describeImage: ["Describe with AI", "用 AI 描述图片", "用 AI 描述圖片", "AIで画像を説明", "Описать с ИИ", "Décrire avec l’IA", "Mit KI beschreiben", "Describir con IA"],
  imageControls: ["Image controls", "图片控制", "圖片控制", "画像操作", "Управление изображением", "Commandes de l'image", "Bildsteuerung", "Controles de imagen"],
  noOpenImage: ["No image viewer open", "尚未打开图片查看器", "尚未開啟圖片檢視器", "画像ビューアは開いていません", "Просмотр изображения не открыт", "Aucune visionneuse ouverte", "Kein Bildbetrachter geöffnet", "No hay un visor de imágenes abierto"],
  zoomIn: ["Zoom in", "放大", "放大", "拡大", "Увеличить", "Agrandir", "Vergrößern", "Acercar"],
  zoomOut: ["Zoom out", "缩小", "縮小", "縮小", "Уменьшить", "Réduire", "Verkleinern", "Alejar"],
  rotateImage: ["Rotate", "旋转", "旋轉", "回転", "Повернуть", "Pivoter", "Drehen", "Girar"],
  resetImage: ["Reset image", "复位图片", "重設圖片", "画像をリセット", "Сбросить изображение", "Réinitialiser l'image", "Bild zurücksetzen", "Restablecer imagen"],
  panLeft: ["Pan left", "向左平移", "向左平移", "左に移動", "Сдвинуть влево", "Déplacer à gauche", "Nach links verschieben", "Mover a la izquierda"],
  panRight: ["Pan right", "向右平移", "向右平移", "右に移動", "Сдвинуть вправо", "Déplacer à droite", "Nach rechts verschieben", "Mover a la derecha"],
  panUp: ["Pan up", "向上平移", "向上平移", "上に移動", "Сдвинуть вверх", "Déplacer vers le haut", "Nach oben verschieben", "Mover hacia arriba"],
  panDown: ["Pan down", "向下平移", "向下平移", "下に移動", "Сдвинуть вниз", "Déplacer vers le bas", "Nach unten verschieben", "Mover hacia abajo"],
  showImage: ["Show image", "查看图片", "檢視圖片", "画像を表示", "Показать изображение", "Afficher l'image", "Bild anzeigen", "Mostrar imagen"],
  closeImage: ["Close image", "关闭图片", "關閉圖片", "画像を閉じる", "Закрыть изображение", "Fermer l'image", "Bild schließen", "Cerrar imagen"],
  imageUpdated: ["Image updated", "图片已更新", "圖片已更新", "画像を更新しました", "Изображение обновлено", "Image mise à jour", "Bild aktualisiert", "Imagen actualizada"],
  imageScale: ["Zoom", "缩放", "縮放", "倍率", "Масштаб", "Zoom", "Zoom", "Zoom"],
  imageRotation: ["Rotation", "旋转角度", "旋轉角度", "回転角度", "Поворот", "Rotation", "Drehung", "Rotación"],
  imagePanX: ["Horizontal offset", "水平偏移", "水平位移", "水平オフセット", "Смещение по горизонтали", "Décalage horizontal", "Horizontaler Versatz", "Desplazamiento horizontal"],
  imagePanY: ["Vertical offset", "垂直偏移", "垂直位移", "垂直オフセット", "Смещение по вертикали", "Décalage vertical", "Vertikaler Versatz", "Desplazamiento vertical"],
  references: ["Notes and links", "脚注与链接", "註腳與連結", "注釈とリンク", "Примечания и ссылки", "Notes et liens", "Anmerkungen und Links", "Notas y enlaces"],
  reference: ["Reference", "引用", "引用", "参照", "Ссылка", "Référence", "Verweis", "Referencia"],
  images: ["Book images", "书内图片", "書內圖片", "書籍の画像", "Иллюстрации книги", "Images du livre", "Buchbilder", "Imágenes del libro"],
  image: ["Image", "图片", "圖片", "画像", "Изображение", "Image", "Bild", "Imagen"],
  noSections: ["No source sections", "没有源文件分节", "沒有來源分節", "元のセクションなし", "Нет разделов источника", "Aucune section source", "Keine Quellabschnitte", "Sin secciones de origen"],
  noReferences: ["No notes or links in this section", "本节没有脚注或链接", "本節沒有註腳或連結", "このセクションに注釈やリンクはありません", "В разделе нет примечаний или ссылок", "Aucune note ni aucun lien dans cette section", "Keine Anmerkungen oder Links in diesem Abschnitt", "Sin notas ni enlaces en esta sección"],
  noImages: ["No images in this section", "本节没有图片", "本節沒有圖片", "このセクションに画像はありません", "В разделе нет изображений", "Aucune image dans cette section", "Keine Bilder in diesem Abschnitt", "Sin imágenes en esta sección"],
  reference_resolved: ["Internal reference", "书内引用", "書內引用", "書籍内の参照", "Внутренняя ссылка", "Référence interne", "Interner Verweis", "Referencia interna"],
  reference_external: ["External link", "外部链接", "外部連結", "外部リンク", "Внешняя ссылка", "Lien externe", "Externer Link", "Enlace externo"],
  reference_blocked: ["Blocked link", "已阻止的链接", "已封鎖的連結", "ブロックされたリンク", "Заблокированная ссылка", "Lien bloqué", "Blockierter Link", "Enlace bloqueado"],
  reference_missing: ["Reference target not found", "找不到引用目标", "找不到引用目標", "参照先が見つかりません", "Цель ссылки не найдена", "Cible de référence introuvable", "Verweisziel nicht gefunden", "Destino de referencia no encontrado"],
  reference_unsupported: ["Unsupported reference", "不支持的引用", "不支援的引用", "非対応の参照", "Неподдерживаемая ссылка", "Référence non prise en charge", "Nicht unterstützter Verweis", "Referencia no compatible"],
  image_missing: ["Image not found", "找不到图片", "找不到圖片", "画像が見つかりません", "Изображение не найдено", "Image introuvable", "Bild nicht gefunden", "Imagen no encontrada"],
  image_external: ["Remote image not loaded", "未加载远程图片", "未載入遠端圖片", "リモート画像は未読込", "Удалённое изображение не загружено", "Image distante non chargée", "Externes Bild nicht geladen", "Imagen remota no cargada"],
  image_unsupported: ["Unsupported image", "不支持的图片", "不支援的圖片", "非対応の画像", "Неподдерживаемое изображение", "Image non prise en charge", "Nicht unterstütztes Bild", "Imagen no compatible"],
  nativeReference: ["Show reader note", "在阅读器预览脚注", "在閱讀器預覽註腳", "リーダーで注釈を表示", "Показать примечание в читалке", "Afficher la note dans le lecteur", "Anmerkung im Reader anzeigen", "Mostrar nota en el lector"],
  nativeImage: ["Open image viewer", "打开图片查看器", "開啟圖片檢視器", "画像ビューアを開く", "Открыть просмотр изображения", "Ouvrir la visionneuse", "Bildbetrachter öffnen", "Abrir visor de imágenes"],
  copyImage: ["Copy image", "复制图片", "複製圖片", "画像をコピー", "Копировать изображение", "Copier l'image", "Bild kopieren", "Copiar imagen"],
  saveImage: ["Save image", "保存图片", "儲存圖片", "画像を保存", "Сохранить изображение", "Enregistrer l'image", "Bild speichern", "Guardar imagen"],
  imageCopied: ["Image copied", "图片已复制", "圖片已複製", "画像をコピーしました", "Изображение скопировано", "Image copiée", "Bild kopiert", "Imagen copiada"],
  imageSaved: ["Image saved", "图片已保存", "圖片已儲存", "画像を保存しました", "Изображение сохранено", "Image enregistrée", "Bild gespeichert", "Imagen guardada"],
  searching: ["Searching", "搜索中", "搜尋中", "検索中", "Поиск", "Recherche en cours", "Suche läuft", "Buscando"],
  searchCancelled: ["Search cancelled", "搜索已取消", "搜尋已取消", "検索をキャンセルしました", "Поиск отменён", "Recherche annulée", "Suche abgebrochen", "Búsqueda cancelada"],
  timedOut: ["Search timed out", "搜索超时", "搜尋逾時", "検索がタイムアウトしました", "Поиск превысил время ожидания", "La recherche a expiré", "Die Suche hat das Zeitlimit überschritten", "La búsqueda agotó el tiempo"],
  scanLimit: ["Search stopped at its section limit", "搜索已达到分节上限", "搜尋已達到分節上限", "セクション上限で検索を停止しました", "Поиск остановлен на лимите разделов", "Recherche arrêtée à la limite de sections", "Suche am Abschnittslimit angehalten", "Búsqueda detenida en el límite de secciones"],
  resultLimit: ["Search stopped at its result limit", "搜索已达到结果上限", "搜尋已達到結果上限", "結果上限で検索を停止しました", "Поиск остановлен на лимите результатов", "Recherche arrêtée à la limite de résultats", "Suche am Ergebnislimit angehalten", "Búsqueda detenida en el límite de resultados"],
  stale: ["The book changed; search again", "书籍内容已变化，请重新搜索", "書籍內容已變更，請重新搜尋", "本の内容が変わりました。もう一度検索してください", "Книга изменилась; выполните поиск снова", "Le livre a changé ; relancez la recherche", "Das Buch wurde geändert; suche erneut", "El libro cambió; vuelve a buscar"],
  temporaryMarks: ["Temporary marks", "临时标记", "暫時標記", "一時マーク", "Временные отметки", "Marques temporaires", "Temporäre Markierungen", "Marcas temporales"],
  noTemporaryMarks: ["No temporary marks", "没有临时标记", "沒有暫時標記", "一時マークなし", "Нет временных отметок", "Aucune marque temporaire", "Keine temporären Markierungen", "Sin marcas temporales"],
  markResults: ["Mark these results", "标记本批结果", "標記這批結果", "この結果をマーク", "Отметить эти результаты", "Marquer ces résultats", "Diese Treffer markieren", "Marcar estos resultados"],
  highlightMarks: ["Temporary highlight", "临时强调", "暫時強調", "一時ハイライト", "Временная подсветка", "Surlignage temporaire", "Temporär hervorheben", "Resaltado temporal"],
  underlineMarks: ["Temporary underline", "临时下划线", "暫時底線", "一時下線", "Временное подчёркивание", "Soulignement temporaire", "Temporär unterstreichen", "Subrayado temporal"],
  removeMarks: ["Remove marks", "移除标记", "移除標記", "マークを削除", "Удалить отметки", "Retirer les marques", "Markierungen entfernen", "Quitar marcas"],
  attachedPassages: ["Attached passages", "已呈现文档内的段落", "已呈現文件內的段落", "描画文書内の文章", "Отрывки в отображаемом документе", "Passages du document affiché", "Textstellen im gerenderten Dokument", "Pasajes del documento mostrado"],
  emphasis_attached: ["Attached", "已附着", "已附加", "配置済み", "Прикреплено", "Attaché", "Angefügt", "Adjunto"],
  emphasis_deferred: ["Awaiting document", "等待文档呈现", "等待文件呈現", "文書の描画待ち", "Ожидание документа", "En attente du document", "Warten auf Dokument", "Esperando documento"],
  emphasis_partial: ["Partially attached", "部分已附着", "部分已附加", "一部配置済み", "Частично прикреплено", "Partiellement attaché", "Teilweise angefügt", "Adjunto parcialmente"],
  emphasis_error: ["Mark could not be rendered", "无法呈现标记", "無法呈現標記", "マークを描画できません", "Не удалось отобразить отметку", "Impossible d’afficher la marque", "Markierung konnte nicht dargestellt werden", "No se pudo mostrar la marca"],
  selectPassage: ["Select passage", "选中段落", "選取段落", "文章を選択", "Выделить отрывок", "Sélectionner le passage", "Textstelle auswählen", "Seleccionar pasaje"],
  clearSelection: ["Clear selection", "清除选区", "清除選取", "選択を解除", "Снять выделение", "Effacer la sélection", "Auswahl aufheben", "Quitar selección"],
  inspectPassage: ["Inspect passage", "查看段落", "檢視段落", "文章を確認", "Просмотреть отрывок", "Examiner le passage", "Textstelle prüfen", "Examinar pasaje"],
  inspectSelection: ["Current selection", "当前选区", "目前選取範圍", "現在の選択", "Текущее выделение", "Sélection actuelle", "Aktuelle Auswahl", "Selección actual"],
  noSourceRange: ["No versioned passage is available", "没有可用的版本化段落", "沒有可用的版本化段落", "バージョン付きの文章はありません", "Нет доступного версионированного отрывка", "Aucun passage versionné disponible", "Keine versionierte Textstelle verfügbar", "No hay un pasaje versionado disponible"],
  findPassage: ["Find a passage", "查找段落", "尋找段落", "文章を探す", "Найти отрывок", "Trouver un passage", "Textstelle finden", "Buscar un pasaje"],
  passage: ["Passage", "段落", "段落", "文章", "Отрывок", "Passage", "Textstelle", "Pasaje"],
  sourceSection: ["Source section", "源文件分节", "來源分節", "元のセクション", "Раздел источника", "Section source", "Quellabschnitt", "Sección de origen"],
  openPassage: ["Open passage", "跳转到段落", "跳至段落", "文章を開く", "Открыть отрывок", "Ouvrir le passage", "Textstelle öffnen", "Abrir pasaje"],
  matchCase: ["Match case", "区分大小写", "區分大小寫", "大文字と小文字を区別", "Учитывать регистр", "Respecter la casse", "Groß-/Kleinschreibung beachten", "Distinguir mayúsculas"],
  wholeWords: ["Whole words", "全词匹配", "全詞比對", "単語単位", "Слова целиком", "Mots entiers", "Ganze Wörter", "Palabras completas"],
  invalidPassage: ["Enter 1-500 characters", "请输入 1–500 个字符", "請輸入 1–500 個字元", "1〜500文字で入力してください", "Введите 1–500 символов", "Saisissez 1 à 500 caractères", "1–500 Zeichen eingeben", "Introduzca de 1 a 500 caracteres"],
  searchPending: ["No matches in this batch", "本批次没有匹配", "本批次沒有符合項目", "この範囲に一致なし", "В этой порции совпадений нет", "Aucun résultat dans ce lot", "Keine Treffer in diesem Abschnitt", "Sin coincidencias en este lote"],
  noPassageMatches: ["No matching passage", "没有匹配的段落", "沒有符合的段落", "一致する文章なし", "Отрывок не найден", "Aucun passage correspondant", "Keine passende Textstelle", "Ningún pasaje coincide"],
  search: ["Search", "搜索", "搜尋", "検索", "Поиск", "Rechercher", "Suchen", "Buscar"],
  searchBook: ["Search this book", "搜索本书", "搜尋本書", "この本を検索", "Поиск в книге", "Rechercher dans ce livre", "Dieses Buch durchsuchen", "Buscar en este libro"],
  searchShelf: ["Search indexed books", "搜索已索引书籍", "搜尋已索引書籍", "索引済みの本を検索", "Поиск в индексированных книгах", "Rechercher dans les livres indexés", "Indizierte Bücher durchsuchen", "Buscar en libros indexados"],
  variants: ["Queries (one per line)", "查询词（每行一个）", "查詢詞（每行一個）", "検索語（1行に1つ）", "Запросы (по одному в строке)", "Requêtes (une par ligne)", "Suchanfragen (eine pro Zeile)", "Consultas (una por línea)"],
  invalidQueries: ["Enter 1-12 queries, up to 1024 characters each", "请输入 1–12 个查询词，每个不超过 1024 字符", "請輸入 1–12 個查詢詞，每個不超過 1024 字元", "1〜12件、各1024文字以内で入力してください", "Введите 1–12 запросов, до 1024 символов каждый", "Saisissez 1 à 12 requêtes de 1024 caractères maximum", "1–12 Suchanfragen mit jeweils bis zu 1024 Zeichen eingeben", "Introduzca de 1 a 12 consultas de hasta 1024 caracteres"],
  searchResults: ["Text matches", "正文匹配", "正文比對", "本文の一致", "Совпадения в тексте", "Correspondances", "Texttreffer", "Coincidencias de texto"],
  noMatches: ["No matches in the searched index", "已搜索索引中没有匹配", "已搜尋索引中沒有符合項目", "検索した索引に一致なし", "В просмотренном индексе нет совпадений", "Aucune correspondance dans l'index consulté", "Keine Treffer im durchsuchten Index", "Sin coincidencias en el índice consultado"],
  exactMatch: ["Exact", "精确匹配", "精確比對", "完全一致", "Точное", "Exacte", "Exakt", "Exacta"],
  partialMatch: ["Partial", "词元匹配", "詞元比對", "部分一致", "Частичное", "Partielle", "Teiltreffer", "Parcial"],
  observedState: ["Last text state", "最近正文状态", "最近正文狀態", "直近の本文状態", "Последнее состояние текста", "Dernier état du texte", "Letzter Textstatus", "Último estado del texto"],
  failure: ["Failure", "失败原因", "失敗原因", "失敗理由", "Причина сбоя", "Échec", "Fehler", "Error"],
  busy: ["Another preparation is running", "已有正文准备任务正在进行", "已有正文準備工作正在進行", "別の本文準備が実行中です", "Другая подготовка текста уже идёт", "Une autre préparation est en cours", "Eine andere Textaufbereitung läuft", "Otra preparación está en curso"],
  request: ["Request", "请求状态", "請求狀態", "リクエスト", "Запрос", "Demande", "Anfrage", "Solicitud"],
  requests: ["My requests", "我的请求", "我的請求", "自分のリクエスト", "Мои запросы", "Mes demandes", "Meine Anfragen", "Mis solicitudes"],
  noRequests: ["No requests in this plugin session", "本次插件会话尚无请求", "本次外掛工作階段尚無請求", "このプラグインセッションにリクエストはありません", "В этой сессии плагина нет запросов", "Aucune demande dans cette session du plugin", "Keine Anfragen in dieser Plugin-Sitzung", "Sin solicitudes en esta sesión del complemento"],
  mode: ["Operation", "操作", "操作", "操作", "Операция", "Opération", "Vorgang", "Operación"],
  prepare: ["Prepare text", "准备正文", "準備正文", "本文を準備", "Подготовить текст", "Préparer le texte", "Text aufbereiten", "Preparar texto"],
  rebuild: ["Rebuild index", "重建索引", "重建索引", "索引を再構築", "Перестроить индекс", "Reconstruire l'index", "Index neu aufbauen", "Reconstruir índice"],
  cancelRequest: ["Cancel this request", "取消此请求", "取消此請求", "このリクエストをキャンセル", "Отменить этот запрос", "Annuler cette demande", "Diese Anfrage abbrechen", "Cancelar esta solicitud"],
  confirmRebuild: ["Discard the derived index and extract the source again", "清除派生索引并重新抽取源文件", "清除衍生索引並重新擷取來源檔案", "派生索引を削除して元ファイルから再抽出する", "Удалить производный индекс и извлечь текст заново", "Supprimer l'index dérivé et extraire à nouveau la source", "Abgeleiteten Index verwerfen und Quelle erneut auslesen", "Descartar el índice derivado y extraer de nuevo la fuente"],
  confirmRequired: ["Confirm rebuilding first", "请先确认重建", "請先確認重建", "再構築を確認してください", "Подтвердите перестроение", "Confirmez la reconstruction", "Neuaufbau zuerst bestätigen", "Confirme primero la reconstrucción"],
  task_queued: ["Queued", "已排队", "已排入佇列", "待機中", "В очереди", "En attente", "In Warteschlange", "En cola"],
  task_running: ["Running", "进行中", "進行中", "実行中", "Выполняется", "En cours", "Läuft", "En curso"],
  task_completed: ["Completed", "已完成", "已完成", "完了", "Завершён", "Terminée", "Abgeschlossen", "Completada"],
  task_failed: ["Failed", "已失败", "已失敗", "失敗", "Ошибка", "Échec", "Fehlgeschlagen", "Fallida"],
  task_cancelled: ["Request cancelled", "请求已取消", "請求已取消", "リクエストをキャンセル済み", "Запрос отменён", "Demande annulée", "Anfrage abgebrochen", "Solicitud cancelada"],
  title: ["Text Desk", "正文台", "正文台", "本文一覧", "Текст книг", "Textes des livres", "Buchtexte", "Textos de libros"],
  refresh: ["Refresh", "刷新", "重新整理", "更新", "Обновить", "Actualiser", "Aktualisieren", "Actualizar"],
  open: ["Open book", "打开书籍", "開啟書籍", "本を開く", "Открыть книгу", "Ouvrir le livre", "Buch öffnen", "Abrir libro"],
  previous: ["Previous", "上一页", "上一頁", "前へ", "Назад", "Précédent", "Zurück", "Anterior"],
  next: ["Next", "下一页", "下一頁", "次へ", "Далее", "Suivant", "Weiter", "Siguiente"],
  empty: ["No books", "没有书籍", "沒有書籍", "本がありません", "Нет книг", "Aucun livre", "Keine Bücher", "Sin libros"],
  status: ["Preparation", "准备状态", "準備狀態", "準備状態", "Подготовка", "Préparation", "Vorbereitung", "Preparación"],
  unprepared: ["Not prepared", "尚未准备", "尚未準備", "未準備", "Не подготовлен", "Non préparé", "Nicht vorbereitet", "Sin preparar"],
  preparing: ["Preparing", "准备中", "準備中", "準備中", "Подготовка", "En préparation", "In Vorbereitung", "Preparando"],
  ready: ["Prepared", "已准备", "已準備", "準備済み", "Подготовлен", "Prêt", "Vorbereitet", "Preparado"],
  partial: ["Incomplete", "未完成", "未完成", "未完了", "Не завершено", "Incomplet", "Unvollständig", "Incompleto"],
  unsupported: ["Unsupported", "不支持", "不支援", "非対応", "Не поддерживается", "Non pris en charge", "Nicht unterstützt", "No compatible"],
  unavailable: ["Source unavailable", "源文件不可用", "來源檔案無法使用", "元ファイルなし", "Источник недоступен", "Source indisponible", "Quelle nicht verfügbar", "Fuente no disponible"],
  error: ["Preparation failed", "准备失败", "準備失敗", "準備失敗", "Ошибка подготовки", "Échec de préparation", "Vorbereitung fehlgeschlagen", "Error de preparación"],
  queryError: ["Status could not be loaded", "无法读取状态", "無法讀取狀態", "状態を取得できません", "Не удалось загрузить состояние", "État indisponible", "Status konnte nicht geladen werden", "No se pudo cargar el estado"],
  text: ["Text layer", "文本层", "文字層", "テキスト層", "Текстовый слой", "Couche de texte", "Textebene", "Capa de texto"],
  unknown: ["Unknown", "未知", "未知", "不明", "Неизвестно", "Inconnu", "Unbekannt", "Desconocido"],
  available: ["Text found", "有文本", "有文字", "テキストあり", "Текст найден", "Texte trouvé", "Text vorhanden", "Texto disponible"],
  textless: ["No extractable text", "无可抽取文本", "無可擷取文字", "抽出可能な文字なし", "Нет извлекаемого текста", "Aucun texte extractible", "Kein extrahierbarer Text", "Sin texto extraíble"],
  chapters: ["Indexed chapters", "已索引章节", "已索引章節", "索引済みの章", "Глав в индексе", "Chapitres indexés", "Indizierte Kapitel", "Capítulos indexados"],
  sections: ["Read sections", "已读取分节", "已讀取分節", "読取済みセクション", "Прочитанные разделы", "Sections lues", "Gelesene Abschnitte", "Secciones leídas"],
  failed: ["Failed sections", "失败分节", "失敗分節", "失敗したセクション", "Сбои разделов", "Sections en échec", "Fehlgeschlagene Abschnitte", "Secciones fallidas"],
  unsupportedSections: ["Unsupported sections", "不支持的分节", "不支援的分節", "非対応セクション", "Неподдерживаемые разделы", "Sections non prises en charge", "Nicht unterstützte Abschnitte", "Secciones no compatibles"]
};
function tr(locale, key) {
  return labels[key][Math.max(0, locales.indexOf(locale))];
}

// src/inference-history.ts
var status = (ctx, receipt) => tr(ctx.locale, receipt.interrupted ? "taskInterrupted" : receipt.status === "timed-out" ? "requestTimedOut" : `task_${receipt.status}`);
async function inferenceHistory(ctx) {
  const receipts = await ctx.services.llm.listRequests();
  return {
    kind: "list",
    title: tr(ctx.locale, "inferenceHistory"),
    emptyText: tr(ctx.locale, "noInferenceHistory"),
    items: receipts.slice().reverse().map((receipt) => ({
      id: receipt.requestId,
      title: status(ctx, receipt),
      subtitle: new Date(receipt.createdAt).toLocaleString(ctx.locale),
      icon: "sparkle",
      onSelect: async () => ({ view: await inferenceDetail(ctx, receipt.requestId) })
    })),
    actions: [{
      id: "refresh",
      label: tr(ctx.locale, "refresh"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await inferenceHistory(ctx), navigation: "replace" })
    }]
  };
}
async function inferenceDetail(ctx, id) {
  const receipt = await ctx.services.llm.getRequest(id);
  if (!receipt)
    return { kind: "detail", title: tr(ctx.locale, "inferenceHistory"), content: [{ kind: "text", text: tr(ctx.locale, "noInferenceHistory") }] };
  const unknown = tr(ctx.locale, "unknown");
  return { kind: "detail", title: status(ctx, receipt), content: [
    { kind: "keyValue", rows: [
      { label: "ID", value: receipt.requestId },
      { label: tr(ctx.locale, "recordedAt"), value: new Date(receipt.updatedAt).toLocaleString(ctx.locale) },
      { label: tr(ctx.locale, "inferenceSettlement"), value: tr(ctx.locale, receipt.settled ? "task_completed" : "unknown") },
      ...receipt.errorCode ? [{ label: tr(ctx.locale, "status"), value: receipt.errorCode }] : []
    ] },
    ...receipt.attempts.map((attempt) => ({ kind: "keyValue", rows: [
      { label: tr(ctx.locale, "inferenceModel"), value: `${attempt.model.provider} · ${attempt.model.id}` },
      { label: tr(ctx.locale, "inferenceInput"), value: attempt.usage?.input == null ? unknown : String(attempt.usage.input) },
      { label: tr(ctx.locale, "inferenceOutput"), value: attempt.usage?.output == null ? unknown : String(attempt.usage.output) },
      { label: tr(ctx.locale, "inferenceCost"), value: attempt.estimatedCostUsd === null ? unknown : `$${attempt.estimatedCostUsd.toFixed(6)}` }
    ] }))
  ], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await inferenceDetail(ctx, id), navigation: "replace" }) },
    ...receipt.requestAvailable && receipt.status === "running" ? [{ id: "cancel", label: tr(ctx.locale, "cancelRequest"), icon: "stop", run: async () => {
      await ctx.services.llm.cancelRequest(id);
      return { view: await inferenceDetail(ctx, id), navigation: "replace" };
    } }] : []
  ] };
}

// src/inference-availability.ts
async function inferenceAvailability(ctx) {
  const result = await ctx.services.session.operationAvailability({ operation: "llm.infer", model: "smart", images: true });
  return { kind: "detail", title: tr(ctx.locale, "inferenceAvailability"), content: [
    { kind: "text", text: tr(ctx.locale, "availabilityNote") },
    { kind: "keyValue", rows: result.conditions.map((condition) => ({
      label: tr(ctx.locale, `availability_${condition.kind}`),
      value: tr(ctx.locale, `availability_${condition.state}`)
    })) },
    ...result.conditions.filter((condition) => condition.errorCode).map((condition) => ({ kind: "error", code: condition.errorCode }))
  ], actions: [{
    id: "refresh",
    label: tr(ctx.locale, "refresh"),
    icon: "arrows-clockwise",
    run: async () => ({ view: await inferenceAvailability(ctx), navigation: "replace" })
  }] };
}

// src/reading-availability.ts
async function readingAvailability(ctx, target) {
  const reading = ctx.domains.reading;
  if (!reading)
    throw Error("Text Desk requires reading access");
  const current = target ? null : await reading.queries.session();
  const guard = target ?? (current?.bookId && current.sessionId ? { bookId: current.bookId, sessionId: current.sessionId } : null);
  if (!guard)
    return { kind: "detail", title: tr(ctx.locale, "readingAvailability"), content: [{ kind: "error", code: "reader/unavailable" }] };
  const queries = [
    { operation: "reading.mode.configure", ...guard, active: true },
    { operation: "reading.playback", ...guard, action: "start" },
    { operation: "reading.playback", ...guard, action: "stop" }
  ];
  const results = await Promise.all(queries.map((query) => ctx.services.session.operationAvailability(query)));
  const names = ["enableReadingMode", "startReadingAloud", "stopReadingAloud"];
  const conditionLabel = (reason, kind) => reason === "mode-inactive" ? "readingModeCondition" : reason === "no-unit" || kind === "input" ? "readingUnitCondition" : kind === "provider" ? "readingProviderCondition" : `availability_${kind}`;
  return { kind: "detail", title: tr(ctx.locale, "readingAvailability"), content: [
    { kind: "text", text: tr(ctx.locale, "readingAvailabilityNote") },
    ...results.flatMap((result, i) => [
      { kind: "heading", text: tr(ctx.locale, names[i]) },
      { kind: "keyValue", rows: result.conditions.map((condition) => ({
        label: tr(ctx.locale, conditionLabel(condition.reason, condition.kind)),
        value: tr(ctx.locale, `availability_${condition.state}`)
      })) },
      ...result.conditions.filter((condition) => condition.errorCode).map((condition) => ({ kind: "error", code: condition.errorCode }))
    ])
  ], actions: [
    ...results.flatMap((result, i) => !reading.commands || result.conditions.some((condition) => condition.state === "unavailable" || condition.state === "unconfigured") ? [] : [{
      id: names[i],
      label: tr(ctx.locale, names[i]),
      run: async () => {
        if (i === 0)
          await reading.commands.configureMode({ active: true }, guard);
        else
          await reading.commands.controlPlayback(i === 1 ? "start" : "stop", guard);
        return { view: await readingAvailability(ctx, guard), navigation: "replace" };
      }
    }]),
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await readingAvailability(ctx, guard), navigation: "replace" }) }
  ] };
}

// src/content-state.ts
async function contentState(ctx, bookId, title) {
  let state = await ctx.domains.library.queries.books.getContentState(bookId), failure;
  const view = () => ({
    kind: "detail",
    title: `${title} / ${tr(ctx.locale, "contentSource")}`,
    content: failure ? [{ kind: "error", code: failure }] : [{ kind: "keyValue", rows: [
      { label: tr(ctx.locale, "contentSource"), value: tr(ctx.locale, state.source === "file" ? "sourceFile" : "sourcePlugin") },
      { label: tr(ctx.locale, "status"), value: tr(ctx.locale, state.availability === "local" ? "sourceLocal" : state.availability === "missing" ? "sourceMissing" : state.availability === "provider-registered" ? "sourceRegistered" : "sourceUnavailable") }
    ] }],
    actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await contentState(ctx, bookId, title), navigation: "replace" }) }]
  });
  return { ...view(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.domains.library.events.observeContentState(bookId, async (event, delivery) => {
      if (disposed || delivery?.reaction?.status === "cycle")
        return;
      if (event.status === "ready") {
        state = event.snapshot;
        failure = undefined;
      } else
        failure = event.errorCode;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: ++revision, view: view() });
    }, { ruleId: "content-source-live" });
    return { dispose() {
      disposed = true;
      subscription.dispose();
    } };
  } } };
}

// src/saved-jobs.ts
async function jobDetail(ctx, id) {
  const job = await ctx.services.jobs.get(id);
  const refresh = async () => ({ view: await jobDetail(ctx, id), navigation: "replace" });
  const actions = [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: refresh }];
  if (!["completed", "cancelled"].includes(job.status)) {
    for (const action of job.status === "running" || job.status === "queued" ? ["pause", "cancel"] : ["resume", "cancel"]) {
      actions.push({ id: action, label: tr(ctx.locale, `${action}Request`), run: async () => {
        await ctx.services.jobs.control(id, action);
        return refresh();
      } });
    }
  }
  return { kind: "detail", title: job.title, content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "status"), value: job.status === "needs-attention" ? tr(ctx.locale, "jobAttention") : tr(ctx.locale, `task_${job.status}`) },
    { label: tr(ctx.locale, "durableJobs"), value: `${job.completedSteps} / ${job.totalSteps}` },
    ...job.errorCode ? [{ label: tr(ctx.locale, "jobAttention"), value: job.errorCode }] : []
  ] }], actions };
}
async function savedJobs(ctx, offset = 0) {
  const page = await ctx.services.jobs.list({ offset, limit: 20 });
  const actions = [{ id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await savedJobs(ctx, offset), navigation: "replace" }) }];
  if (page.nextOffset !== null)
    actions.push({ id: "next", label: tr(ctx.locale, "next"), run: async () => ({ view: await savedJobs(ctx, page.nextOffset), navigation: "replace" }) });
  if (offset)
    actions.push({ id: "previous", label: tr(ctx.locale, "previous"), run: async () => ({ view: await savedJobs(ctx, Math.max(0, offset - 20)), navigation: "replace" }) });
  return { kind: "list", title: tr(ctx.locale, "durableJobs"), items: page.jobs.map((job) => ({
    id: job.id,
    title: job.title,
    subtitle: `${job.completedSteps} / ${job.totalSteps}`,
    onSelect: async () => ({ view: await jobDetail(ctx, job.id) })
  })), actions, emptyText: tr(ctx.locale, "empty") };
}

// src/book-updates.ts
var tail = Promise.resolve();
function bookUpdates(ctx, openDetail, advance = false) {
  const result = tail.then(() => load(ctx, openDetail, advance));
  tail = result.then(() => {}, () => {});
  return result;
}
function savedPage(value) {
  if (value === null)
    return null;
  const page = value;
  if (!page || page.version !== 1 || typeof page.cursor !== "string" || !/^[a-f0-9]{48}$/.test(page.cursor) || !Array.isArray(page.ids) || page.ids.length > 50 || page.ids.some((id) => typeof id !== "string" || !id || id.length > 512) || [page.general, page.hasMore, page.baseline, page.reset].some((flag) => typeof flag !== "boolean")) {
    throw Error("Invalid saved book updates");
  }
  return page;
}
async function load(ctx, openDetail, advance) {
  const grant = ctx.grants.book;
  const session = grant.mode === "current" ? await ctx.domains.reading.queries.session() : undefined;
  const bookId = grant.mode === "book" ? grant.bookId : session?.bookId;
  if (grant.mode !== "all" && !bookId)
    return { kind: "list", title: tr(ctx.locale, "bookUpdates"), items: [], emptyText: tr(ctx.locale, "updatesNeedBook") };
  const query = { areas: ["library"], ...bookId ? { bookId } : {} };
  const key = `book-updates:v1:${bookId ? `book:${bookId}` : "all"}`;
  let page = savedPage(await ctx.services.storage.getDurable(key));
  let changed = false;
  const baseline = async (reset) => {
    const { cursor } = await ctx.services.changes.open(query);
    const books = await ctx.domains.library.queries.books.list();
    return {
      version: 1,
      cursor,
      ids: books.filter((book) => !bookId || book.id === bookId).slice(0, 20).map((book) => book.id),
      general: false,
      hasMore: false,
      baseline: true,
      reset
    };
  };
  if (!page) {
    page = await baseline(false);
    changed = true;
  } else if (advance) {
    try {
      const next = await ctx.services.changes.read(query, page.cursor, 50);
      page = {
        version: 1,
        cursor: next.cursor,
        ids: [...new Set(next.changes.flatMap((change) => change.bookId ? [change.bookId] : []))],
        general: next.changes.some((change) => !change.bookId),
        hasMore: next.hasMore,
        baseline: false,
        reset: false
      };
    } catch (error) {
      if (error?.code !== "changes/cursor-expired")
        throw error;
      page = await baseline(true);
    }
    changed = true;
  }
  const items = [{ id: "$notice", title: tr(ctx.locale, page.reset ? "updatesReset" : page.baseline ? "updatesBaseline" : "updatesNote") }];
  if (page.general) {
    await ctx.domains.library.queries.books.list();
    items.push({ id: "$shelf", title: tr(ctx.locale, "updatesShelf") });
  }
  for (const id of page.ids) {
    const book = await ctx.domains.library.queries.books.get(id);
    items.push(book ? {
      id,
      title: book.title,
      subtitle: book.format.toUpperCase(),
      icon: "book-open",
      onSelect: async () => ({ view: await openDetail(ctx, book.id, book.title) })
    } : { id, title: tr(ctx.locale, "updatesRemoved") });
  }
  if (changed)
    await ctx.services.storage.set(key, page);
  if (session) {
    const current = await ctx.domains.reading.queries.session();
    if (current.bookId !== session.bookId || current.sessionId !== session.sessionId)
      throw Error(tr(ctx.locale, "updatesNeedBook"));
  }
  return {
    kind: "list",
    title: tr(ctx.locale, "bookUpdates"),
    items,
    actions: [{
      id: "check-updates",
      label: tr(ctx.locale, page.hasMore ? "updatesMore" : "updatesCheck"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await bookUpdates(ctx, openDetail, true), navigation: "replace" })
    }]
  };
}

// src/task-views.ts
var active = (task) => task.status === "queued" || task.status === "running" || task.status === "paused";
async function requestDetail(ctx, bookId, title, taskId) {
  const task = await ctx.domains.library.queries.books.getTextTask(bookId, taskId);
  return { ...requestSnapshot(ctx, title, task), live: {
    subscribe: (channel) => ctx.domains.library.events.observeTextTask(bookId, taskId, async (current, delivery) => {
      if (delivery?.reaction?.status === "cycle")
        return;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: current.revision, view: requestSnapshot(ctx, title, current) });
    }, { ruleId: "text-task-live" })
  } };
}
function requestSnapshot(ctx, title, task) {
  const { bookId, taskId } = task;
  const progress = task.textState.progress;
  const rows = [
    { label: tr(ctx.locale, "request"), value: tr(ctx.locale, `task_${task.status}`) },
    { label: tr(ctx.locale, "deadline"), value: new Date(task.deadlineAt).toLocaleString(ctx.locale) },
    { label: tr(ctx.locale, "priority"), value: tr(ctx.locale, task.priority === "background" ? "backgroundPriority" : "normalPriority") },
    ...task.waitReason ? [{ label: tr(ctx.locale, "waiting"), value: tr(ctx.locale, task.waitReason === "reader" ? "readerWait" : "queueWait") }] : [],
    { label: tr(ctx.locale, "mode"), value: tr(ctx.locale, task.mode) },
    { label: tr(ctx.locale, "observedState"), value: tr(ctx.locale, task.textState.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, task.textState.text) },
    { label: tr(ctx.locale, "chapters"), value: String(task.textState.chapterCount) }
  ];
  if (task.history)
    rows.push({ label: tr(ctx.locale, "taskHistory"), value: tr(ctx.locale, task.history.status === "saved" ? "historySaved" : task.history.status === "pending" ? "historyPending" : "historyFailed") });
  if (task.status === "failed")
    rows.push({ label: tr(ctx.locale, "failure"), value: tr(ctx.locale, task.errorCode === "library/text-timeout" ? "taskTimeout" : task.errorCode === "library/text-busy" ? "busy" : task.errorCode === "library/text-unsupported" ? "unsupported" : task.errorCode === "library/content-unavailable" ? "unavailable" : "error") });
  if (progress)
    rows.push({ label: tr(ctx.locale, "sections"), value: `${progress.completed} / ${progress.total}` }, { label: tr(ctx.locale, "failed"), value: String(progress.failed) }, { label: tr(ctx.locale, "unsupportedSections"), value: String(progress.unsupported) });
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({
      view: await requestDetail(ctx, bookId, title, taskId),
      navigation: "replace"
    }) },
    ...active(task) ? [{
      id: "priority",
      label: tr(ctx.locale, task.priority === "background" ? "normalPriority" : "backgroundPriority"),
      icon: "sort-ascending",
      run: async () => {
        await ctx.domains.library.commands.books.setTextTaskPriority(bookId, taskId, task.priority === "background" ? "normal" : "background");
        return { view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace" };
      }
    }, {
      id: task.status === "paused" ? "resume" : "pause",
      label: tr(ctx.locale, task.status === "paused" ? "resumeRequest" : "pauseRequest"),
      icon: task.status === "paused" ? "play" : "pause",
      run: async () => {
        const commands = ctx.domains.library.commands.books;
        await (task.status === "paused" ? commands.resumeTextTask : commands.pauseTextTask)(bookId, taskId);
        return { view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace" };
      }
    }, { id: "cancel", label: tr(ctx.locale, "cancelRequest"), icon: "stop", run: async () => {
      await ctx.domains.library.commands.books.cancelTextTask(bookId, taskId);
      return { view: await requestDetail(ctx, bookId, title, taskId), navigation: "replace" };
    } }] : [],
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) }
  ] };
}
async function startRequest(ctx, bookId, title, rebuild = false, timeoutMs) {
  const task = await ctx.domains.library.commands.books.prepareText(bookId, { rebuild, ...timeoutMs === undefined ? {} : { timeoutMs } });
  return { view: await requestDetail(ctx, bookId, title, task.taskId) };
}
function rebuildForm(ctx, bookId, title) {
  return {
    kind: "form",
    title,
    fields: [{ kind: "checkbox", id: "confirm", label: tr(ctx.locale, "confirmRebuild"), value: false }],
    submitLabel: tr(ctx.locale, "rebuild"),
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: tr(ctx.locale, "confirmRequired") } };
      return { ...await startRequest(ctx, bookId, title, true), navigation: "replace" };
    }
  };
}
async function requestList(ctx, bookId, title) {
  const tasks = await ctx.domains.library.queries.books.listTextTasks(bookId);
  return { kind: "list", title, emptyText: tr(ctx.locale, "noRequests"), items: tasks.reverse().map((task) => ({
    id: task.taskId,
    title: tr(ctx.locale, task.mode),
    subtitle: tr(ctx.locale, `task_${task.status}`),
    timestamp: task.createdAt,
    onSelect: async () => ({ view: await requestDetail(ctx, bookId, title, task.taskId) })
  })), actions: [{
    id: "refresh",
    label: tr(ctx.locale, "refresh"),
    icon: "arrows-clockwise",
    run: async () => ({ view: await requestList(ctx, bookId, title), navigation: "replace" })
  }] };
}
function timedPrepareForm(ctx, bookId, title) {
  return {
    kind: "form",
    title,
    fields: [{
      kind: "number",
      id: "minutes",
      label: tr(ctx.locale, "timeLimit"),
      value: 30,
      min: 1,
      max: 120,
      step: 1,
      helperText: tr(ctx.locale, "timeLimitNote")
    }],
    submitLabel: tr(ctx.locale, "prepare"),
    onSubmit: async (values) => {
      const minutes = values.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 120)
        return { fieldErrors: { minutes: tr(ctx.locale, "timeLimit") } };
      return { ...await startRequest(ctx, bookId, title, false, minutes * 60000), navigation: "replace" };
    }
  };
}

// src/task-history.ts
function entryView(ctx, title, entry) {
  const task = entry.snapshot;
  return { kind: "detail", title, content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "request"), value: tr(ctx.locale, entry.interrupted ? "taskInterrupted" : `task_${task.status}`) },
    { label: tr(ctx.locale, "mode"), value: tr(ctx.locale, task.mode) },
    { label: tr(ctx.locale, "recordedAt"), value: new Date(entry.recordedAt).toLocaleString(ctx.locale) },
    ...task.errorCode === "library/text-timeout" ? [{ label: tr(ctx.locale, "failure"), value: tr(ctx.locale, "taskTimeout") }] : [],
    ...task.textState.progress ? [{ label: tr(ctx.locale, "sections"), value: `${task.textState.progress.completed} / ${task.textState.progress.total}` }] : []
  ] }], actions: entry.requestAvailable ? [{
    id: "current",
    label: tr(ctx.locale, "request"),
    icon: "arrow-right",
    run: async () => ({ view: await requestDetail(ctx, task.bookId, title, task.taskId) })
  }] : [{
    id: "prepare",
    label: tr(ctx.locale, "prepare"),
    icon: "play",
    run: () => startRequest(ctx, task.bookId, title)
  }] };
}
async function taskHistory(ctx, bookId, title, offset = 0) {
  const page = await ctx.domains.library.queries.books.listTextTaskHistory(bookId, { offset, limit: 20 });
  return {
    kind: "list",
    title: `${title} · ${tr(ctx.locale, "taskHistory")}`,
    emptyText: tr(ctx.locale, "noHistory"),
    items: page.items.map((entry) => ({
      id: entry.snapshot.taskId,
      title: tr(ctx.locale, entry.snapshot.mode),
      subtitle: tr(ctx.locale, entry.interrupted ? "taskInterrupted" : `task_${entry.snapshot.status}`),
      timestamp: entry.recordedAt,
      onSelect: () => ({ view: entryView(ctx, title, entry) })
    })),
    actions: [
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await taskHistory(ctx, bookId, title), navigation: "replace" }) },
      ...offset > 0 ? [{ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: async () => ({ view: await taskHistory(ctx, bookId, title, Math.max(0, offset - 20)), navigation: "replace" }) }] : [],
      ...page.nextOffset !== null ? [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: async () => ({ view: await taskHistory(ctx, bookId, title, page.nextOffset), navigation: "replace" }) }] : []
    ]
  };
}

// src/reader-demand.ts
function changeOrigin(ctx, origin) {
  return origin === "system" ? tr(ctx.locale, "originHost") : origin === "user" ? tr(ctx.locale, "originUser") : origin === "agent" ? tr(ctx.locale, "originAgent") : `${tr(ctx.locale, "originPlugin")}: ${origin.slice(7)}`;
}
var reasonLabel = {
  initial: "changeLifecycle",
  open: "changeLifecycle",
  ready: "changeLifecycle",
  detach: "changeLifecycle",
  error: "changeLifecycle",
  close: "changeLifecycle",
  relocate: "relocateActivity",
  navigate: "changeNavigation",
  back: "changeNavigation",
  forward: "changeNavigation",
  step: "changeNavigation",
  reload: "changeNavigation",
  "mode-step": "changeNavigation",
  "mode-return": "changeNavigation",
  selection: "changeSelection",
  controls: "changeControls",
  mode: "changeMode",
  playback: "changePlayback",
  "reader-demand": "readerActivity"
};
function snapshot(ctx, session) {
  const { readerDemand: demand, change } = session;
  return { kind: "detail", title: tr(ctx.locale, "readerActivity"), content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "activityState"), value: tr(ctx.locale, !demand ? "unavailable" : demand.active ? "readerWait" : "readerIdle") },
    ...demand?.reason ? [{ label: tr(ctx.locale, "activitySource"), value: tr(ctx.locale, demand.reason === "render" ? "renderActivity" : "relocateActivity") }] : [],
    ...change ? [
      { label: tr(ctx.locale, "changeReason"), value: tr(ctx.locale, reasonLabel[change.reason]) },
      { label: tr(ctx.locale, "changeOrigin"), value: changeOrigin(ctx, change.origin) }
    ] : []
  ] }] };
}
async function readerDemandDetail(ctx) {
  const reading = ctx.domains.reading;
  const current = await reading.queries.session();
  return { ...snapshot(ctx, current), live: { subscribe: (channel) => {
    let previous;
    return reading.events.observeSession(async (session, delivery) => {
      if (delivery?.reaction?.status === "cycle")
        return;
      const next = JSON.stringify([session.readerDemand, session.change]);
      if (previous === next)
        return;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: session.revision, view: snapshot(ctx, session) });
      previous = next;
    });
  } } };
}

// src/search-task.ts
function textSearchTask(ctx, input, render) {
  const controller = new AbortController, title = tr(ctx.locale, "searchResults");
  let channel, revision = 0, started = false, pending = true;
  const retry = {
    id: "retry",
    label: tr(ctx.locale, "search"),
    icon: "magnifying-glass",
    run: () => ({ view: textSearchTask(ctx, input, render), navigation: "replace" })
  };
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = { kind: "list", title, items: [], emptyText: tr(ctx.locale, "searchCancelled"), actions: [retry] };
    }
  };
  let current = { kind: "blocks", title, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel",
      label: tr(ctx.locale, "cancelRequest"),
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
      console.warn("Text Desk search view publication failed", error);
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
      const hits = await ctx.domains.library.queries.books.searchText(input, { signal: controller.signal });
      if (controller.signal.aborted)
        return;
      const result = await render(hits);
      if (controller.signal.aborted)
        return;
      current = result;
    } catch (error) {
      if (controller.signal.aborted)
        return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title, blocks: [
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

// src/search-views.ts
function textSearchForm(ctx, bookId) {
  return {
    kind: "form",
    title: tr(ctx.locale, bookId ? "searchBook" : "searchShelf"),
    fields: [{ kind: "textarea", id: "queries", label: tr(ctx.locale, "variants"), value: "" }],
    submitLabel: tr(ctx.locale, "search"),
    onSubmit: async (values) => {
      const queries = String(values.queries ?? "").split(`
`).map((query) => query.trim()).filter(Boolean);
      if (!queries.length || queries.length > 12 || queries.some((query) => query.length > 1024)) {
        return { fieldErrors: { queries: tr(ctx.locale, "invalidQueries") } };
      }
      return { view: textSearchTask(ctx, { queries, bookId, limit: 40 }, (hits) => textSearchResults(ctx, hits)) };
    }
  };
}
async function textSearchResults(ctx, hits) {
  const books = new Map((await ctx.domains.library.queries.books.list()).map((book) => [book.id, book]));
  return {
    kind: "list",
    title: tr(ctx.locale, "searchResults"),
    emptyText: tr(ctx.locale, "noMatches"),
    items: hits.map((hit) => ({
      id: `${hit.bookId}:${hit.chapterIndex}:${hit.offset}`,
      title: books.get(hit.bookId)?.title ?? tr(ctx.locale, "unavailable"),
      icon: "book-open",
      subtitle: `${tr(ctx.locale, hit.match === "exact" ? "exactMatch" : "partialMatch")} · ${hit.chapterTitle ?? String(hit.chapterIndex + 1)}`,
      onSelect: () => ({ view: hitDetail(ctx, hit, books.get(hit.bookId)?.title ?? tr(ctx.locale, "unavailable")) })
    }))
  };
}
function hitDetail(ctx, hit, title) {
  return { kind: "detail", title, content: [{ kind: "text", text: hit.snippet }], actions: [
    { id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.openBook(hit.bookId);
      return { close: true };
    } },
    { id: "search-book", label: tr(ctx.locale, "searchBook"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx, hit.bookId) }) }
  ] };
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
  library: { version: "1.34.0", pluginAccess: ["read", "write"] },
  reading: { version: "2.24.0", pluginAccess: ["read", "write"] },
  annotations: { version: "2.2.0", pluginAccess: ["read", "write"] },
  conversations: { version: "1.6.0", pluginAccess: ["read", "write"] },
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
  ui: { version: "1.17.0", permission: null },
  schedules: { version: "2.0.0", permission: null },
  jobs: { version: "1.1.0", permission: null },
  changes: { version: "1.0.0", permission: null },
  transactions: { version: "1.0.0", permission: null },
  session: { version: "2.11.0", permission: null },
  plugins: { version: "1.10.0", permission: null },
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
function awaitAbortable(promise, signal, status2) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: "aborted", status: status2() ?? "cancelled" });
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((value) => finish({ kind: "value", value }), (error) => finish({ kind: "error", error }));
    if (signal.aborted)
      onAbort();
  });
}
function runResult(bookId, status2, contentVersion, hits, scannedSections, totalSections, textStatus) {
  return { status: status2, bookId, contentVersion, hits, scannedSections, totalSections, textStatus };
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
  const terminal = (status2) => runResult(input.bookId, status2, status2 === "stale" ? null : version, [], scannedSections, totalSections, textStatus);
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
// src/reader-session.ts
async function ensureReadingSession(ctx, bookId) {
  const reading = ctx.domains.reading, current = await reading.queries.session();
  const session = current.bookId === bookId && current.status === "ready" ? current : await reading.commands.openBook(bookId);
  return { bookId, sessionId: session.sessionId };
}

// src/emphasis-views.ts
async function markPassages(ctx, ranges) {
  const guard = await ensureReadingSession(ctx, ranges[0].bookId);
  const receipt = await ctx.domains.reading.commands.putEmphasis({ ranges }, guard);
  return { view: emphasisDetail(ctx, receipt.emphasis, ranges) };
}
function emphasisDetail(ctx, mark, ranges) {
  const guard = { bookId: mark.bookId, sessionId: mark.sessionId };
  return { kind: "detail", title: tr(ctx.locale, "temporaryMarks"), content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "status"), value: tr(ctx.locale, `emphasis_${mark.status}`) },
    { label: tr(ctx.locale, "attachedPassages"), value: `${mark.attached} / ${mark.count}` }
  ] }], actions: [
    { id: "show-mark", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.goTo(ranges[0]);
      return { close: true };
    } },
    { id: "style", label: tr(ctx.locale, mark.style === "highlight" ? "underlineMarks" : "highlightMarks"), icon: "text-aa", run: async () => {
      const next = await ctx.domains.reading.commands.putEmphasis({
        ranges,
        id: mark.id,
        expectedRevision: mark.revision,
        style: mark.style === "highlight" ? "underline" : "highlight"
      }, guard);
      return { view: emphasisDetail(ctx, next.emphasis, ranges), navigation: "replace" };
    } },
    { id: "remove-mark", label: tr(ctx.locale, "removeMarks"), icon: "x", run: async () => {
      await ctx.domains.reading.commands.removeEmphasis({ id: mark.id, expectedRevision: mark.revision }, guard);
      return { view: await emphasisList(ctx), navigation: "replace" };
    } },
    { id: "all-marks", label: tr(ctx.locale, "temporaryMarks"), icon: "list-bullets", run: async () => ({ view: await emphasisList(ctx) }) }
  ] };
}
function emphasisSnapshot(ctx, marks) {
  return {
    kind: "list",
    title: tr(ctx.locale, "temporaryMarks"),
    emptyText: tr(ctx.locale, "noTemporaryMarks"),
    items: marks.map((mark) => ({
      id: mark.id,
      title: `${tr(ctx.locale, "passage")} · ${mark.count}`,
      subtitle: `${tr(ctx.locale, `emphasis_${mark.status}`)} · ${mark.attached} / ${mark.count}`,
      icon: "text-aa",
      actions: [{ id: "remove", label: tr(ctx.locale, "removeMarks"), icon: "x", run: async () => {
        await ctx.domains.reading.commands.removeEmphasis({ id: mark.id, expectedRevision: mark.revision }, { bookId: mark.bookId, sessionId: mark.sessionId });
        return { view: await emphasisList(ctx), navigation: "replace" };
      } }]
    })),
    actions: [{
      id: "refresh",
      label: tr(ctx.locale, "refresh"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await emphasisList(ctx), navigation: "replace" })
    }]
  };
}
async function emphasisList(ctx) {
  return { ...emphasisSnapshot(ctx, await ctx.domains.reading.queries.emphasis()), live: { subscribe: (channel) => {
    let revision = 0;
    return ctx.domains.reading.events.observeEmphasis(async (marks, delivery) => {
      if (delivery?.reaction?.status === "cycle")
        return;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: ++revision, view: emphasisSnapshot(ctx, marks) });
    });
  } } };
}

// src/range-views.ts
async function capturedRangeDetail(ctx, range) {
  if (range)
    return rangeDetail(ctx, { range });
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [{ kind: "text", text: tr(ctx.locale, "noSourceRange") }] };
}
function rangeSearchForm(ctx, bookId) {
  return { kind: "form", title: tr(ctx.locale, "findPassage"), fields: [
    { kind: "text", id: "query", label: tr(ctx.locale, "passage") },
    { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false },
    { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false }
  ], submitLabel: tr(ctx.locale, "search"), onSubmit: async (values) => {
    const query = String(values.query ?? "").trim();
    if (!query || query.length > 500)
      return { fieldErrors: { query: tr(ctx.locale, "invalidPassage") } };
    return { view: rangeSearchTask(ctx, { bookId, query, matchCase: values.matchCase === true, wholeWords: values.wholeWords === true, limit: 20 }) };
  } };
}
function rangeList(ctx, input, run) {
  const emptyKey = run.status === "cancelled" ? "searchCancelled" : run.status === "timed-out" ? "timedOut" : run.status === "scan-limit" ? "scanLimit" : run.status === "result-limit" ? "resultLimit" : run.status === "stale" ? "stale" : run.textStatus === "available" ? "noPassageMatches" : run.textStatus === "textless" ? "textless" : "unsupportedSections";
  const title = run.status === "completed" ? input.query : `${input.query} · ${tr(ctx.locale, emptyKey)}`;
  return {
    kind: "list",
    title,
    emptyText: tr(ctx.locale, emptyKey),
    items: run.hits.map((hit) => ({
      id: hit.id,
      title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
      icon: "magnifying-glass",
      subtitle: `${tr(ctx.locale, "sourceSection")} ${hit.sectionIndex + 1} · ${hit.id}`,
      onSelect: async () => ({ view: await rangeDetail(ctx, { range: hit.range }) })
    })),
    actions: [
      ...run.hits.length ? [{
        id: "mark-results",
        label: tr(ctx.locale, "markResults"),
        icon: "text-aa",
        run: () => markPassages(ctx, run.hits.map((hit) => hit.range))
      }] : [],
      ...run.status === "timed-out" || run.status === "scan-limit" || run.status === "result-limit" ? [{
        id: "retry",
        label: tr(ctx.locale, "search"),
        icon: "magnifying-glass",
        run: () => ({ view: rangeSearchTask(ctx, input), navigation: "replace" })
      }] : []
    ]
  };
}
function progressView(ctx, input, value, cancel) {
  return { kind: "blocks", title: input.query, blocks: [{
    kind: "progress",
    value: value.totalSections ? Math.min(value.scannedSections, value.totalSections) : null,
    ...value.totalSections ? { max: value.totalSections, showValue: true } : {},
    label: value.totalSections ? `${tr(ctx.locale, "searching")} (${value.scannedSections}/${value.totalSections})` : tr(ctx.locale, "searching"),
    cancel: { id: "cancel", label: tr(ctx.locale, "cancelRequest"), run: cancel }
  }] };
}
function rangeSearchTask(ctx, input) {
  const controller = new AbortController;
  let channel, revision = 0, started = false, pending = true;
  const retry = {
    id: "retry",
    label: tr(ctx.locale, "search"),
    icon: "magnifying-glass",
    run: () => ({ view: rangeSearchTask(ctx, input), navigation: "replace" })
  };
  const cancelled = () => ({
    kind: "list",
    title: input.query,
    items: [],
    emptyText: tr(ctx.locale, "searchCancelled"),
    actions: [retry]
  });
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = cancelled();
    }
  };
  let current = progressView(ctx, input, { scannedSections: 0, totalSections: 0, hitCount: 0, contentVersion: null }, async () => {
    stop();
    await publish();
  });
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
      console.warn("Text Desk range search view publication failed", error);
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
        current = progressView(ctx, input, value, async () => {
          stop();
          await publish();
        });
        await publish();
      } });
      if (controller.signal.aborted)
        return;
      pending = false;
      current = run.status === "cancelled" ? cancelled() : rangeList(ctx, input, run);
    } catch (error) {
      if (controller.signal.aborted)
        return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      pending = false;
      current = { kind: "blocks", title: input.query, blocks: [
        { kind: "error", code },
        ...retryable ? [{ kind: "actions", actions: [retry] }] : []
      ] };
    }
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
async function rangeDetail(ctx, input) {
  const page = await ctx.domains.library.queries.books.readRange(input);
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [
    ...page.context.before ? [{ kind: "text", text: page.context.before }] : [],
    { kind: "quote", text: page.text, caption: `${page.offset + 1}-${page.offset + page.text.length} / ${page.totalLength}` },
    ...page.context.after ? [{ kind: "text", text: page.context.after }] : []
  ], actions: [
    { id: "mark-passage", label: tr(ctx.locale, "highlightMarks"), icon: "text-aa", run: () => markPassages(ctx, [page.range]) },
    { id: "select-passage", label: tr(ctx.locale, "selectPassage"), icon: "text-aa", run: async () => {
      const guard = await ensureReadingSession(ctx, page.range.bookId);
      await ctx.domains.reading.commands.selectRange(page.range, guard);
      return { close: true };
    } },
    { id: "open-passage", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.goTo(page.range);
      return { close: true };
    } },
    ...page.nextOffset === null ? [] : [{
      id: "next",
      label: tr(ctx.locale, "next"),
      icon: "arrow-right",
      run: async () => ({ view: await rangeDetail(ctx, { ...input, range: page.range, offset: page.nextOffset }), navigation: "replace" })
    }],
    { id: "search-again", label: tr(ctx.locale, "findPassage"), icon: "magnifying-glass", run: () => ({ view: rangeSearchForm(ctx, page.range.bookId) }) }
  ] };
}

// src/content-pagination.ts
function contentPagination(offsets, nextOffset, load2) {
  const go = async (next) => ({ view: await load2(next), navigation: "replace" });
  return {
    page: offsets.length,
    ...offsets.length > 1 ? { onPrevious: () => go(offsets.slice(0, -1)) } : {},
    ...nextOffset === null ? {} : { onNext: () => go([...offsets, nextOffset]) }
  };
}

// src/reference-views.ts
async function referenceList(ctx, source, offsets = [0]) {
  const page = await ctx.domains.library.queries.books.listReferences({ ...source, offset: offsets[offsets.length - 1], limit: 20 });
  return {
    kind: "list",
    title: tr(ctx.locale, "references"),
    searchable: true,
    emptyText: tr(ctx.locale, page.status === "unsupported" ? "unsupported" : "noReferences"),
    items: page.items.map((item) => ({
      id: String(item.reference.index),
      title: item.label || `${tr(ctx.locale, "reference")} ${item.reference.index + 1}`,
      icon: item.kind === "inline-note" ? "note-pencil" : "link",
      onSelect: async () => ({ view: await referenceDetail(ctx, item.reference) })
    })),
    pagination: contentPagination(offsets, page.nextOffset, (next) => referenceList(ctx, source, next))
  };
}
async function referenceDetail(ctx, reference, offsets = [0]) {
  const input = { reference, offset: offsets[offsets.length - 1], limit: 4000 };
  const preview = await ctx.domains.library.queries.books.readReference(input);
  const pagination = contentPagination(offsets, preview.nextOffset, (next) => referenceDetail(ctx, preview.reference, next));
  return { kind: "detail", title: preview.label || tr(ctx.locale, "reference"), content: [
    { kind: "text", text: tr(ctx.locale, `reference_${preview.status}`) },
    ...preview.text ? [{
      kind: "quote",
      text: preview.text,
      caption: `${preview.offset + 1}-${preview.offset + preview.text.length} / ${preview.totalLength}`
    }] : [],
    ...preview.url ? [{ kind: "text", text: preview.url }] : []
  ], actions: [
    ...preview.location ? [{ id: "open-source", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.goTo(preview.location);
      return { close: true };
    } }] : [],
    ...preview.status === "resolved" ? [{ id: "native-preview", label: tr(ctx.locale, "nativeReference"), icon: "note-pencil", run: async () => {
      const guard = await ensureReadingSession(ctx, reference.bookId);
      const receipt = await ctx.services.ui.reader.previewReference(input, guard);
      return receipt.status === "opened" ? { close: true } : { toast: tr(ctx.locale, `reference_${receipt.preview.status}`) };
    } }] : [],
    ...pagination.onPrevious ? [{ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: pagination.onPrevious }] : [],
    ...pagination.onNext ? [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: pagination.onNext }] : []
  ] };
}

// src/image-controls.ts
async function openImageControls(ctx, query) {
  const guard = await ensureReadingSession(ctx, query.image.bookId);
  const receipt = await ctx.services.ui.reader.image.open(query, guard);
  if (receipt.status !== "opened")
    return { toast: tr(ctx.locale, `image_${receipt.reason}`) };
  return { view: await imageControls(ctx) };
}
async function imageControls(ctx) {
  const image = ctx.services.ui.reader?.image;
  if (!image?.control)
    throw Object.assign(Error("Image controls unavailable"), { code: "ui/unavailable" });
  const control = image.control.bind(image);
  const render = (snapshot2) => {
    const actions = [];
    if (snapshot2) {
      const id = snapshot2.id;
      const request = async (operation) => {
        const receipt = await control(operation);
        return receipt.status === "closed" ? { close: "all" } : { toast: tr(ctx.locale, "imageUpdated") };
      };
      for (const [action, label, icon] of [
        ["zoom-in", "zoomIn", "plus"],
        ["zoom-out", "zoomOut", "magnifying-glass"],
        ["rotate", "rotateImage", "arrows-clockwise"],
        ["reset", "resetImage", "arrows-clockwise"]
      ])
        actions.push({ id: action, label: tr(ctx.locale, label), icon, run: () => request({ id, action }) });
      for (const [direction, dx, dy, icon] of [
        ["panLeft", -0.15, 0, "arrow-left"],
        ["panRight", 0.15, 0, "arrow-right"],
        ["panUp", 0, -0.15, undefined],
        ["panDown", 0, 0.15, undefined]
      ])
        actions.push({
          id: direction,
          label: tr(ctx.locale, direction),
          icon,
          run: () => request({ id, action: "pan", dx, dy })
        });
      actions.push({ id: "show-image", label: tr(ctx.locale, "showImage"), icon: "arrow-square-out", run: () => ({ close: "all" }) }, { id: "close-image", label: tr(ctx.locale, "closeImage"), icon: "stop", run: () => request({ id, action: "close" }) });
    }
    actions.push({
      id: "refresh",
      label: tr(ctx.locale, "refresh"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await imageControls(ctx), navigation: "replace" })
    });
    return {
      kind: "detail",
      title: tr(ctx.locale, "imageControls"),
      content: snapshot2 ? [{ kind: "keyValue", rows: [
        { label: tr(ctx.locale, "imageScale"), value: `${Math.round(snapshot2.scale * 100)}%` },
        { label: tr(ctx.locale, "imageRotation"), value: `${snapshot2.rotation}°` },
        { label: tr(ctx.locale, "imagePanX"), value: `${Math.round(snapshot2.panX * 100)}%` },
        { label: tr(ctx.locale, "imagePanY"), value: `${Math.round(snapshot2.panY * 100)}%` }
      ] }] : [{ kind: "text", text: tr(ctx.locale, "noOpenImage") }],
      actions
    };
  };
  return { ...render(await image.snapshot()), live: { subscribe(channel) {
    let active2 = true, revision = 0;
    const subscription = image.observe(async (snapshot2, delivery) => {
      if (!active2 || delivery?.reaction?.status === "cycle")
        return;
      await ctx.withEvent(delivery).services.ui.publishView(channel, { revision: ++revision, view: render(snapshot2) });
    });
    return { dispose() {
      if (!active2)
        return;
      active2 = false;
      subscription.dispose();
    } };
  } } };
}

// src/image-views.ts
async function imageList(ctx, source, offsets = [0]) {
  const page = await ctx.domains.library.queries.books.listImages({ ...source, offset: offsets[offsets.length - 1], limit: 20 });
  return {
    kind: "list",
    title: tr(ctx.locale, "images"),
    searchable: true,
    emptyText: tr(ctx.locale, page.status === "unsupported" ? "unsupported" : "noImages"),
    items: page.items.map((item) => ({
      id: String(item.image.index),
      title: item.alt || `${tr(ctx.locale, "image")} ${item.image.index + 1}`,
      icon: "book-bookmark",
      presentation: "dialog",
      onSelect: async () => ({ view: await imageDetail(ctx, item) })
    })),
    pagination: contentPagination(offsets, page.nextOffset, (next) => imageList(ctx, source, next))
  };
}
async function imageDetail(ctx, image) {
  const query = { image: image.image }, resources2 = ctx.services.resources;
  const result = await ctx.domains.library.queries.books.openImageResource(query);
  const title = image.alt || `${tr(ctx.locale, "image")} ${image.image.index + 1}`;
  if (result.status !== "ready")
    return {
      kind: "detail",
      title,
      content: [{ kind: "text", text: tr(ctx.locale, `image_${result.status}`) }]
    };
  const resource = result.resource;
  const inference = new AbortController;
  return {
    kind: "detail",
    title,
    content: [{ kind: "image", resourceId: resource.id, alt: result.image.alt || title }],
    actions: [
      ...ctx.services.llm ? [{ id: "describe-image", label: tr(ctx.locale, "describeImage"), icon: "sparkle", run: async () => {
        const description = await ctx.services.llm.ask({
          prompt: `Describe this illustration in ${ctx.locale}. Discuss only visible content; mark uncertainty. Do not invent surrounding book context.`,
          images: [{ resourceId: resource.id }],
          model: "smart",
          requestId: crypto.randomUUID(),
          maxOutputTokens: 1200,
          maxTotalOutputTokens: 1200,
          maxOutputChars: 6000,
          signal: inference.signal
        });
        return { view: { kind: "detail", title: tr(ctx.locale, "describeImage"), content: [{ kind: "text", text: description }] } };
      } }] : [],
      {
        id: "image-controls",
        label: tr(ctx.locale, "imageControls"),
        icon: "magnifying-glass",
        run: () => openImageControls(ctx, query)
      },
      { id: "native-image", label: tr(ctx.locale, "nativeImage"), icon: "arrow-square-out", run: async () => {
        const guard = await ensureReadingSession(ctx, image.image.bookId);
        const receipt = await ctx.services.ui.reader.image.open(query, guard);
        return receipt.status === "opened" ? { close: "all" } : { toast: tr(ctx.locale, `image_${receipt.reason}`) };
      } },
      { id: "save-image", label: tr(ctx.locale, "saveImage"), icon: "download-simple", run: async () => (await resources2.save(resource.id, resource.name)).saved ? { toast: tr(ctx.locale, "imageSaved") } : null },
      { id: "copy-image", label: tr(ctx.locale, "copyImage"), icon: "copy", run: async () => {
        await ctx.services.clipboard.writeImage(resource.id);
        return { toast: tr(ctx.locale, "imageCopied") };
      } },
      ...result.image.location ? [{ id: "open-source", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
        await ctx.domains.reading.commands.goTo(result.image.location);
        return { close: "all" };
      } }] : []
    ],
    onClose: () => {
      inference.abort();
      return resources2.release(resource.id);
    }
  };
}

// src/content-sections.ts
async function contentSections(ctx, bookId, title, kind, contentVersion, offsets = [0]) {
  const library = ctx.domains.library.queries.books;
  const version = contentVersion ?? (await library.getNavigationToc(bookId)).contentVersion;
  const page = await library.listNavigationTargets({
    bookId,
    contentVersion: version,
    kind: "sections",
    offset: offsets[offsets.length - 1],
    limit: 20
  });
  return {
    kind: "list",
    title: `${title} / ${tr(ctx.locale, kind)}`,
    searchable: true,
    emptyText: tr(ctx.locale, "noSections"),
    items: page.items.map((item) => ({
      id: String(item.index),
      title: item.label || `${tr(ctx.locale, "sourceSection")} ${item.index + 1}`,
      icon: "file-text",
      ...item.sectionIndex === null ? {} : { onSelect: async () => {
        const input = { bookId: page.bookId, contentVersion: page.contentVersion, sectionIndex: item.sectionIndex };
        return { view: await (kind === "images" ? imageList(ctx, input) : referenceList(ctx, input)) };
      } }
    })),
    actions: [{
      id: "refresh",
      label: tr(ctx.locale, "refresh"),
      icon: "arrows-clockwise",
      run: async () => ({ view: await contentSections(ctx, bookId, title, kind), navigation: "replace" })
    }],
    pagination: contentPagination(offsets, page.nextOffset, (next) => contentSections(ctx, bookId, title, kind, page.contentVersion, next))
  };
}

// src/preparation-availability.ts
async function preparationAvailability(ctx, bookId, title, rebuild = false) {
  const result = await ctx.services.session.operationAvailability({ operation: "library.text.prepare", bookId, rebuild });
  const blocked = result.conditions.some((condition) => condition.state === "unavailable" || condition.state === "unconfigured");
  return { kind: "detail", title, content: [
    { kind: "heading", text: tr(ctx.locale, rebuild ? "rebuildPrerequisites" : "preparationPrerequisites") },
    { kind: "text", text: tr(ctx.locale, "preparationPrerequisitesNote") },
    { kind: "keyValue", rows: result.conditions.map((condition) => ({
      label: tr(ctx.locale, condition.kind === "provider" ? "sourceProvider" : `availability_${condition.kind}`),
      value: tr(ctx.locale, `availability_${condition.state}`)
    })) },
    ...result.conditions.filter((condition) => condition.errorCode).map((condition) => ({ kind: "error", code: condition.errorCode }))
  ], actions: [
    ...!blocked && ctx.domains.library?.commands ? [{
      id: "execute",
      label: tr(ctx.locale, rebuild ? "rebuild" : "prepare"),
      icon: "play",
      run: () => rebuild ? { view: rebuildForm(ctx, bookId, title) } : startRequest(ctx, bookId, title)
    }] : [],
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await preparationAvailability(ctx, bookId, title, rebuild), navigation: "replace" }) },
    { id: "switch", label: tr(ctx.locale, rebuild ? "preparationPrerequisites" : "rebuildPrerequisites"), run: async () => ({ view: await preparationAvailability(ctx, bookId, title, !rebuild), navigation: "replace" }) }
  ] };
}

// src/bookmark-services.ts
function bookmarkPage(value) {
  const invalid = () => Object.assign(Error("Invalid bookmark page"), { code: "plugin/service-result-invalid" });
  if (!value || typeof value !== "object")
    throw invalid();
  const page = value;
  if (!["ready", "stale-cursor"].includes(page.status) || !Array.isArray(page.items) || page.items.length > 20 || page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 8192) || page.items.some((item) => !item || typeof item.id !== "string" || item.id.length > 1024 || typeof item.name !== "string" || item.name.length > 120 || !["location", "selection"].includes(item.kind)))
    throw invalid();
  return page;
}
async function jumperBookmarks(ctx, bookId, title, service, cursor) {
  const refresh = { id: "refresh", label: tr(ctx.locale, "refresh"), run: async () => ({ view: await jumperBookmarks(ctx, bookId, title), navigation: "replace" }) };
  const heading = `${title} · ${tr(ctx.locale, "jumperBookmarks")}`;
  const message = (key) => ({
    kind: "detail",
    title: heading,
    content: [{ kind: "text", text: tr(ctx.locale, key) }],
    actions: [refresh]
  });
  const ref = service ?? (await ctx.services.plugins.listServices({ pluginId: "jumper", id: "bookmark-page" })).services.find((item) => item.version === "1.0.0")?.ref;
  if (!ref)
    return message("jumperUnavailable");
  let page;
  try {
    const request = { service: ref, bookId, input: { limit: 20, ...cursor === undefined ? {} : { cursor } } };
    const availability = await ctx.services.session.operationAvailability({ operation: "plugins.callService", serviceCall: request });
    if (availability.state === "unavailable" || availability.state === "unconfigured") {
      const blocked = availability.conditions.find((item) => item.state === "unavailable" || item.state === "unconfigured");
      throw Object.assign(Error("Bookmark service unavailable"), { code: blocked?.errorCode ?? "plugin/service-unavailable" });
    }
    page = bookmarkPage((await ctx.services.plugins.callService(request)).value);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "plugin/service-unavailable")
      return message("jumperChanged");
    throw error;
  }
  if (page.status === "stale-cursor")
    return message("jumperChanged");
  return {
    kind: "list",
    title: heading,
    items: page.items.map((item) => ({ id: item.id, title: item.name, icon: "book-bookmark" })),
    emptyText: tr(ctx.locale, "jumperEmpty"),
    actions: [refresh, ...page.nextCursor === null ? [] : [{
      id: "next",
      label: tr(ctx.locale, "next"),
      run: async () => ({ view: await jumperBookmarks(ctx, bookId, title, ref, page.nextCursor), navigation: "replace" })
    }]]
  };
}

// src/views.ts
async function textDetail(ctx, bookId, title) {
  const state = await ctx.domains.library.queries.books.getTextState(bookId);
  const rows = [
    { label: tr(ctx.locale, "status"), value: tr(ctx.locale, state.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, state.text) },
    { label: tr(ctx.locale, "chapters"), value: String(state.chapterCount) }
  ];
  if (state.progress)
    rows.push({ label: tr(ctx.locale, "sections"), value: `${state.progress.completed} / ${state.progress.total}` }, { label: tr(ctx.locale, "failed"), value: String(state.progress.failed) }, { label: tr(ctx.locale, "unsupportedSections"), value: String(state.progress.unsupported) });
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "content-source", label: tr(ctx.locale, "contentSource"), run: async () => ({ view: await contentState(ctx, bookId, title) }) },
    { id: "jumper-bookmarks", label: tr(ctx.locale, "jumperBookmarks"), icon: "book-bookmark", run: async () => ({ view: await jumperBookmarks(ctx, bookId, title) }) },
    { id: "preparation-prerequisites", label: tr(ctx.locale, "preparationPrerequisites"), run: async () => ({ view: await preparationAvailability(ctx, bookId, title) }) },
    { id: "search", label: tr(ctx.locale, "searchBook"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx, bookId) }) },
    { id: "find-passage", label: tr(ctx.locale, "findPassage"), icon: "magnifying-glass", run: () => ({ view: rangeSearchForm(ctx, bookId) }) },
    { id: "references", label: tr(ctx.locale, "references"), icon: "link", run: async () => ({ view: await contentSections(ctx, bookId, title, "references") }) },
    { id: "images", label: tr(ctx.locale, "images"), icon: "book-bookmark", run: async () => ({ view: await contentSections(ctx, bookId, title, "images") }) },
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await textDetail(ctx, bookId, title), navigation: "replace" }) },
    { id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
      await ctx.domains.reading.commands.openBook(bookId);
      return { close: true };
    } },
    { id: "history", label: tr(ctx.locale, "taskHistory"), icon: "clock-counter-clockwise", run: async () => ({ view: await taskHistory(ctx, bookId, title) }) },
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) },
    ...state.status !== "unsupported" ? [
      { id: "prepare", label: tr(ctx.locale, "prepare"), icon: "play", run: () => startRequest(ctx, bookId, title) },
      { id: "timed-prepare", label: tr(ctx.locale, "timedPrepare"), icon: "timer", run: () => ({ view: timedPrepareForm(ctx, bookId, title) }) },
      { id: "rebuild", label: tr(ctx.locale, "rebuild"), icon: "arrows-clockwise", run: () => ({ view: rebuildForm(ctx, bookId, title) }) }
    ] : []
  ] };
}
async function textDesk(ctx, page = 0) {
  const books = await ctx.domains.library.queries.books.list();
  const index = Math.min(Math.max(0, page), Math.max(0, Math.ceil(books.length / 20) - 1));
  const items = [];
  for (const book of books.slice(index * 20, (index + 1) * 20)) {
    let label;
    try {
      label = tr(ctx.locale, (await ctx.domains.library.queries.books.getTextState(book.id)).status);
    } catch {
      label = tr(ctx.locale, "queryError");
    }
    items.push({
      id: book.id,
      title: book.title,
      subtitle: `${book.format.toUpperCase()} · ${label}`,
      icon: "book-open",
      onSelect: async () => ({ view: await textDetail(ctx, book.id, book.title) })
    });
  }
  const actions = [{
    id: "refresh",
    label: tr(ctx.locale, "refresh"),
    icon: "arrows-clockwise",
    run: async () => ({ view: await textDesk(ctx, index), navigation: "replace" })
  }];
  actions.push({ id: "saved-jobs", label: tr(ctx.locale, "durableJobs"), run: async () => ({ view: await savedJobs(ctx) }) });
  actions.push({ id: "book-updates", label: tr(ctx.locale, "bookUpdates"), run: async () => ({ view: await bookUpdates(ctx, textDetail) }) });
  const pageBooks = books.slice(index * 20, (index + 1) * 20);
  if (pageBooks.length)
    actions.push({ id: "prepare-page", label: tr(ctx.locale, "preparePage"), run: async () => {
      await ctx.services.jobs.start({ title: tr(ctx.locale, "preparePage"), steps: pageBooks.map((book, i) => ({ id: `book-${i}`, kind: "library.text.prepare", bookId: book.id, options: { priority: "background" } })) });
      return { view: await savedJobs(ctx) };
    } });
  if (ctx.services.llm)
    actions.push({ id: "inference-history", label: tr(ctx.locale, "inferenceHistory"), icon: "clock-counter-clockwise", run: async () => ({ view: await inferenceHistory(ctx) }) });
  actions.push({ id: "reader-activity", label: tr(ctx.locale, "readerActivity"), icon: "book-open", run: async () => ({ view: await readerDemandDetail(ctx) }) });
  actions.push({ id: "search", label: tr(ctx.locale, "searchShelf"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx) }) });
  actions.push({ id: "temporary-marks", label: tr(ctx.locale, "temporaryMarks"), icon: "text-aa", run: async () => ({ view: await emphasisList(ctx) }) });
  actions.push({
    id: "selection",
    label: tr(ctx.locale, "inspectSelection"),
    icon: "text-aa",
    run: async () => ({ view: await capturedRangeDetail(ctx, (await ctx.domains.reading.queries.session()).selection?.range) })
  });
  const session = await ctx.domains.reading.queries.session();
  if (session.selection && session.sessionId && session.bookId) {
    const selectionId = session.selection.id;
    const guard = { sessionId: session.sessionId, bookId: session.bookId };
    actions.push({
      id: "clear-selection",
      label: tr(ctx.locale, "clearSelection"),
      icon: "x",
      run: async () => {
        await ctx.domains.reading.commands.clearSelection(selectionId, guard);
        return { close: true };
      }
    });
  }
  for (const direction of [-1, 1])
    if (index + direction >= 0 && (index + direction) * 20 < books.length)
      actions.push({
        id: direction < 0 ? "previous" : "next",
        label: tr(ctx.locale, direction < 0 ? "previous" : "next"),
        icon: direction < 0 ? "arrow-left" : "arrow-right",
        run: async () => ({ view: await textDesk(ctx, index + direction), navigation: "replace" })
      });
  return { kind: "list", title: `${tr(ctx.locale, "title")} · ${index + 1}`, items, actions, emptyText: tr(ctx.locale, "empty") };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    if (!ctx.domains.library?.commands || !ctx.domains.reading?.commands)
      throw Error("Text Desk requires library:write and reading:write");
    const title = tr(ctx.locale, "title");
    ctx.contributions.commands.register({ id: "book-updates", title: `${title}: ${tr(ctx.locale, "bookUpdates")}`, icon: "clock-counter-clockwise", run: async () => ({ view: await bookUpdates(ctx, textDetail) }) });
    ctx.contributions.commands.register({ id: "reading-availability", title: `${title}: ${tr(ctx.locale, "readingAvailability")}`, icon: "speaker-high", run: async () => ({ view: await readingAvailability(ctx) }) });
    ctx.contributions.commands.register({ id: "inference-availability", title: `${title}: ${tr(ctx.locale, "inferenceAvailability")}`, icon: "sparkle", run: async () => ({ view: await inferenceAvailability(ctx) }) });
    ctx.contributions.commands.register({ id: "open", title, icon: "book-open", run: async () => ({ view: await textDesk(ctx) }) });
    ctx.contributions.commands.register({
      id: "image-controls",
      title: `${title}: ${tr(ctx.locale, "imageControls")}`,
      icon: "magnifying-glass",
      run: async () => ({ view: await imageControls(ctx) })
    });
    if (ctx.services.llm)
      ctx.contributions.commands.register({ id: "inference-history", title: `${title}: ${tr(ctx.locale, "inferenceHistory")}`, icon: "clock-counter-clockwise", run: async () => ({ view: await inferenceHistory(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "book-open", surface: "reader", presentation: "popup", view: () => textDesk(ctx) });
    ctx.contributions.selectionActions.register({
      id: "inspect-passage",
      title: tr(ctx.locale, "inspectPassage"),
      icon: "magnifying-glass",
      presentation: "dialog",
      run: async (input) => ({ view: await capturedRangeDetail(ctx, input.range) })
    });
  }
};
export {
  src_default as default
};
