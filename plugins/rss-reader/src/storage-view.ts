import type { PluginDetailView } from "@read-aware/plugin-types";
import type { RssPluginContext } from "./types";

const en = ["Stored data", "Preferences", "Subscriptions and cached articles", "Private files", "Refresh",
  "Preferences can sync. Subscriptions, cached articles and private files stay on this device. Sync delivery has not been checked.",
  "Full app backups include preferences, documents and private files, but exclude plugin credentials. OPML exports contain subscription URLs, not cached articles.",
  "There is no total quota for preferences or documents. Batch document writes have a per-document and per-batch limit. Figures below count persisted payload bytes, not total disk use.", "Document / batch write limit"] as const;
const copies: Record<string, readonly string[]> = {
  en,
  "zh-Hans": ["存储数据", "偏好设置", "订阅与文章缓存", "私有文件", "刷新", "偏好设置可漫游；订阅、文章缓存和私有文件仅保存在本机。此处未检查同步是否送达。", "完整应用备份包含偏好、文档和私有文件，但不含插件凭据。OPML 导出仅含订阅地址，不含文章缓存。", "偏好和文档未设总配额。批量文档写入有单文档和单批限制。以下仅统计已落盘的内容字节，不代表磁盘总占用。", "单文档 / 单批写入限制"],
  "zh-Hant": ["儲存資料", "偏好設定", "訂閱與文章快取", "私人檔案", "重新整理", "偏好設定可漫遊；訂閱、文章快取與私人檔案僅存在本機。此處未檢查同步是否送達。", "完整應用程式備份包含偏好、文件與私人檔案，但不含外掛憑證。OPML 僅匯出訂閱網址，不含文章快取。", "偏好與文件未設總配額。批次文件寫入有單文件與單批限制。以下僅統計已保存的內容位元組，不代表磁碟總用量。", "單文件 / 單批寫入限制"],
  ja: ["保存データ", "設定", "購読と記事キャッシュ", "非公開ファイル", "更新", "設定は同期対象です。購読・記事キャッシュ・非公開ファイルは端末内のみです。同期の到達状況は未確認です。", "アプリ全体のバックアップには設定・文書・非公開ファイルが含まれますが、プラグイン認証情報は含まれません。OPML は購読 URL のみです。", "設定と文書には合計容量制限がありません。文書の一括書き込みには文書単位と一括単位の制限があります。表示は保存済み本文のバイト数で、ディスク使用量全体ではありません。", "文書 / 一括書き込み制限"],
  de: ["Gespeicherte Daten", "Einstellungen", "Abonnements und Artikelcache", "Private Dateien", "Aktualisieren", "Einstellungen können synchronisiert werden. Abonnements, Artikelcache und private Dateien bleiben lokal. Die Übertragung wurde nicht geprüft.", "Vollständige App-Backups enthalten Einstellungen, Dokumente und private Dateien, aber keine Plugin-Zugangsdaten. OPML exportiert nur Abonnement-URLs.", "Für Einstellungen und Dokumente gilt kein Gesamtkontingent. Dokumentstapel haben Einzel- und Stapellimits. Angezeigt werden gespeicherte Nutzdatenbytes, nicht der gesamte Speicherbedarf.", "Limit pro Dokument / Stapel"],
  fr: ["Données stockées", "Préférences", "Abonnements et cache d’articles", "Fichiers privés", "Actualiser", "Les préférences peuvent être synchronisées. Abonnements, cache et fichiers privés restent locaux. La livraison de la synchronisation n’a pas été vérifiée.", "Les sauvegardes complètes incluent préférences, documents et fichiers privés, mais pas les identifiants du plugin. OPML exporte uniquement les URL d’abonnement.", "Aucun quota total pour les préférences et documents. Les écritures groupées ont des limites par document et par lot. Les chiffres comptent les octets de contenu enregistrés, pas l’espace disque total.", "Limite par document / lot"],
  es: ["Datos almacenados", "Preferencias", "Suscripciones y caché de artículos", "Archivos privados", "Actualizar", "Las preferencias pueden sincronizarse. Suscripciones, caché y archivos privados son locales. No se ha comprobado la entrega de la sincronización.", "Las copias completas incluyen preferencias, documentos y archivos privados, pero no credenciales del plugin. OPML solo exporta las URL de suscripción.", "No hay cuota total para preferencias y documentos. Las escrituras por lotes tienen límites por documento y lote. Las cifras cuentan bytes de contenido guardado, no el uso total del disco.", "Límite por documento / lote"],
  ru: ["Сохранённые данные", "Настройки", "Подписки и кэш статей", "Личные файлы", "Обновить", "Настройки могут синхронизироваться. Подписки, кэш и личные файлы остаются на устройстве. Доставка синхронизации не проверена.", "Полная резервная копия включает настройки, документы и личные файлы, но не учётные данные плагина. OPML экспортирует только URL подписок.", "Общей квоты настроек и документов нет. Пакетная запись ограничена размером документа и пакета. Показаны байты сохранённого содержимого, а не полный объём на диске.", "Лимит документа / пакета"],
};
export const storageCopy = (locale: string) => copies[locale] ?? copies[locale.split("-")[0]!] ?? en;
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
export async function storageView(ctx: RssPluginContext): Promise<PluginDetailView> {
  await ctx.services.storage.flush();
  const policy = await ctx.services.storage.policy(), t = storageCopy(ctx.locale);
  return { kind: "detail", title: t[0]!, content: [
    { kind: "keyValue", rows: [
      { label: t[1]!, value: bytes(policy.usage.kv.valueBytes) },
      { label: t[2]!, value: `${policy.usage.documents.items} · ${bytes(policy.usage.documents.valueBytes)}` },
      { label: t[3]!, value: `${policy.usage.assets.items} / ${policy.assets.maxItems} · ${bytes(policy.usage.assets.valueBytes)} / ${bytes(policy.assets.maxBytes)}` },
      { label: t[8]!, value: `${bytes(policy.documents.applyMaxDocumentBytes)} / ${bytes(policy.documents.applyMaxBatchBytes)}` },
    ] },
    ...[5, 6, 7].map(index => ({ kind: "text" as const, text: t[index]! })),
  ], actions: [{ id: "refresh", label: t[4]!, icon: "arrows-clockwise", run: async () => ({ view: await storageView(ctx), navigation: "replace" }) }] };
}
