const text: Record<string, [string, string]> = {
  en: ["Open in another app", "Open request sent to the system"],
  "zh-Hans": ["用其他应用打开", "已向系统发送打开请求"],
  "zh-Hant": ["用其他應用程式開啟", "已向系統傳送開啟請求"],
  ja: ["別のアプリで開く", "システムに開くリクエストを送信しました"],
  de: ["In anderer App öffnen", "Öffnungsanfrage an das System gesendet"],
  fr: ["Ouvrir dans une autre application", "Demande d’ouverture envoyée au système"],
  es: ["Abrir en otra aplicación", "Solicitud de apertura enviada al sistema"],
  ru: ["Открыть в другом приложении", "Запрос на открытие отправлен системе"],
};
export function externalStrings(locale: string) { const [open, dispatched] = text[locale] ?? text[locale.split("-")[0]] ?? text.en; return { open, dispatched }; }
