// src/profiles.ts
var LEGACY_PROFILE_PATHS = ["shelf.layout", "shelf.group", "shelf.sort", "appearance.theme", "appearance.motion", "reading.fontSize", "reading.lineSpacing"];
var PROFILE_PATHS = [...LEGACY_PROFILE_PATHS, "reading.fontFamily", "appearance.contentTypography.fontFamily", "appearance.contentTypography.followReader"];
var profileCollection = (ctx) => ctx.services.storage.collection("profiles");
var invalid = (message) => {
  throw Object.assign(Error(message), { code: "plugin/invalid-input" });
};
function profileName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
    return invalid("Profile name must contain 1-80 characters");
  return name.trim();
}
function parseProfile(value) {
  if (!value || typeof value !== "object")
    return null;
  const profile = value;
  const paths = profile.version === 1 ? LEGACY_PROFILE_PATHS : PROFILE_PATHS;
  if (![1, 2].includes(profile.version) || typeof profile.name !== "string" || !profile.name.trim() || profile.name.trim().length > 80 || !Array.isArray(profile.changes) || profile.changes.length !== paths.length || profile.changes.some((change) => !change || typeof change !== "object" || !paths.includes(change.path) || change.target?.kind !== "global" || !(change.value === null && (change.path === "reading.fontFamily" || change.path === "appearance.contentTypography.fontFamily") || typeof change.value === "boolean" || typeof change.value === "number" && Number.isFinite(change.value) || typeof change.value === "string" && change.value.length <= 1024)) || new Set(profile.changes.map((change) => change.path)).size !== paths.length)
    return null;
  return { version: profile.version, name: profile.name.trim(), changes: paths.map((path) => ({
    path,
    value: profile.changes.find((change) => change.path === path).value,
    target: { kind: "global" }
  })) };
}
async function listProfiles(ctx, cursor, limit = 40) {
  return profileCollection(ctx).page({ limit, ...cursor ? { cursor } : {} });
}
async function captureProfile(ctx, name) {
  const cleanName = profileName(name);
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const changes = PROFILE_PATHS.map((path) => {
    const setting = snapshot.settings.find((setting2) => setting2.path === path);
    if (!setting?.writable)
      throw Object.assign(Error(`Profile setting unavailable: ${path}`), { code: "plugin/unavailable" });
    return { path, value: setting.value, target: { kind: "global" } };
  });
  const profile = parseProfile({ version: 2, name: cleanName, changes });
  if (!profile)
    return invalid("Invalid workspace snapshot");
  return profile;
}
async function profileToken(profile) {
  const bytes = new TextEncoder().encode(JSON.stringify(profile.changes));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `wp1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function saveProfile(ctx, name, expectedToken) {
  const profile = await captureProfile(ctx, name);
  if (expectedToken !== undefined && await profileToken(profile) !== expectedToken)
    return { status: "stale-workspace" };
  const id = crypto.randomUUID();
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "put", collection: "profiles", id, data: profile, expectedRevision: null }]);
  return receipt.status === "conflict" ? { status: "conflict" } : { status: "saved", id, name: profile.name };
}
async function applyProfile(ctx, id, expectedRevision) {
  const doc = await profileCollection(ctx).get(id);
  if (!doc || doc.revision !== expectedRevision)
    return { status: "conflict" };
  const profile = parseProfile(doc.data);
  if (!profile)
    return invalid("Invalid workspace profile");
  const preview = await ctx.services.transactions.preview([
    { kind: "document.check", collection: "profiles", id, expectedRevision },
    { kind: "settings", changes: profile.changes }
  ]);
  try {
    const receipt = await ctx.services.transactions.commit(preview.id);
    return { status: "applied", id, name: profile.name, transactionId: receipt.id };
  } catch (error) {
    if (error.code === "transaction/conflict")
      return { status: "conflict" };
    throw error;
  }
}
async function renameProfile(ctx, id, name, expectedRevision) {
  const cleanName = profileName(name);
  const doc = await profileCollection(ctx).get(id);
  if (!doc || doc.revision !== expectedRevision)
    return { status: "conflict" };
  const profile = parseProfile(doc.data);
  if (!profile)
    return invalid("Invalid workspace profile");
  const receipt = await ctx.services.storage.applyDocuments([{
    kind: "put",
    collection: "profiles",
    id,
    data: { ...profile, name: cleanName },
    expectedRevision
  }]);
  return receipt.status === "conflict" ? { status: "conflict" } : { status: "renamed", id, name: cleanName };
}
async function deleteProfile(ctx, id, expectedRevision) {
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "delete", collection: "profiles", id, expectedRevision }]);
  return { status: receipt.status === "conflict" ? "conflict" : "deleted", id };
}
async function undoProfile(ctx, receiptId) {
  const preview = await ctx.services.transactions.previewUndo(receiptId);
  return ctx.services.transactions.commit(preview.id);
}
var SUMMARY_PATHS = ["shelf.layout", "appearance.theme", "reading.fontSize"];
async function describeProfile(ctx, profile) {
  const snapshot = await ctx.domains.settings.queries.snapshot({ target: { kind: "global" } });
  const entries = profile.changes.map((change) => {
    const descriptor = snapshot.settings.find((setting) => setting.path === change.path);
    const option = descriptor?.options?.find((option2) => option2.value === change.value);
    return { path: change.path, label: descriptor?.label ?? change.path, value: change.value, ...option ? { valueLabel: option.label } : {} };
  });
  return { entries, summary: SUMMARY_PATHS.flatMap((path) => entries.filter((entry) => entry.path === path)) };
}

// src/tools.ts
var invalid2 = () => {
  throw Object.assign(Error("Invalid workspace tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key) => !allowed.includes(key)))
    invalid2();
}
function text(value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalid2();
  return value;
}
var string = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
function registerProfileTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Workspace Profiles requires agent:tools");
  ctx.contributions.agentTools.register({
    name: "workspace_profiles",
    label: "Inspect workspace profiles",
    contexts: ["global", "book"],
    description: "Read-only workspace presets. List returns a bounded page of names, IDs and revisions; continue with nextCursor, restart on stale-cursor. Inspect requires an exact id and returns the preset values and revision for manage_workspace_profile. Current returns the ten global preset settings and workspaceToken for save_workspace_profile. Does not change settings, select a profile or save. Invalid entries may only be deleted.",
    parameters: { type: "object", properties: { operation: { type: "string", enum: ["list", "inspect", "current"] }, id: string(), cursor: string(8192), limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["operation"], additionalProperties: false },
    execute: async (params) => {
      if (params.operation === "list") {
        fields(params, ["operation", "cursor", "limit"]);
        const limit = params.limit ?? 10;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20)
          return invalid2();
        const page = await listProfiles(ctx, params.cursor === undefined ? undefined : text(params.cursor, 8192), limit);
        if (page.status === "stale-cursor")
          return page;
        return { status: "ready", nextCursor: page.nextCursor, items: page.items.map((doc) => {
          const profile = parseProfile(doc.data);
          return { id: doc.id, revision: doc.revision, valid: Boolean(profile), ...profile ? { name: profile.name, version: profile.version } : {} };
        }) };
      }
      if (params.operation === "current") {
        fields(params, ["operation"]);
        const profile = await captureProfile(ctx, "Current workspace");
        return { changes: profile.changes, workspaceToken: await profileToken(profile) };
      }
      if (params.operation === "inspect") {
        fields(params, ["operation", "id"]);
        const id = text(params.id), doc = await profileCollection(ctx).get(id);
        if (!doc)
          return { status: "not-found", id };
        const profile = parseProfile(doc.data);
        return { status: profile ? "ready" : "invalid-profile", id, revision: doc.revision, ...profile ? { profile } : {} };
      }
      return invalid2();
    }
  });
  ctx.contributions.agentTools.register({
    name: "save_workspace_profile",
    label: "Save workspace profile",
    contexts: ["global", "book"],
    approval: "required",
    description: "After host approval, save a named copy of the global workspace previously inspected using workspace_profiles(current). Requires its unchanged workspaceToken; returns stale-workspace if those ten values changed. Captures shelf layout/group/sort, app theme/motion, global reader font size/spacing/font and independent content font/follow-reader. No host settings are changed. Does not overwrite an existing profile; repeated successful calls may create separate presets.",
    parameters: { type: "object", properties: { name: string(80), workspaceToken: { type: "string", pattern: "^wp1:[a-f0-9]{64}$" } }, required: ["name", "workspaceToken"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["name", "workspaceToken"]);
      const name = profileName(params.name), token = text(params.workspaceToken, 68);
      if (!/^wp1:[a-f0-9]{64}$/.test(token))
        return invalid2();
      return saveProfile(ctx, name, token);
    }
  });
  ctx.contributions.agentTools.register({
    name: "manage_workspace_profile",
    label: "Manage workspace profile",
    contexts: ["global", "book"],
    approval: "required",
    description: "Apply or permanently delete an exact workspace preset after host approval. First inspect it with workspace_profiles(inspect), then pass the exact id and expectedRevision. Changed documents return conflict. Apply submits the inspected preset values in one host settings update, preserving per-book overrides; version 1 changes seven fields and leaves fonts unchanged, version 2 changes ten. Delete conditionally removes only the preset. No book data, selection, AI privacy, credentials or plugin lifecycle changes. Apply checks the profile revision and settings in one transaction and returns transactionId for conditional undo; it is not a font-rendering completion receipt.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["apply", "delete"] }, id: string(), expectedRevision: string() }, required: ["action", "id", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["action", "id", "expectedRevision"]);
      const id = text(params.id), revision = text(params.expectedRevision);
      if (params.action === "delete")
        return deleteProfile(ctx, id, revision);
      if (params.action !== "apply")
        return invalid2();
      const result = await applyProfile(ctx, id, revision);
      return result;
    }
  });
  ctx.contributions.agentTools.register({
    name: "undo_workspace_profile",
    label: "Undo workspace profile",
    contexts: ["global"],
    approval: "required",
    description: "Conditionally undo the exact transactionId returned by manage_workspace_profile(apply). Host approval is required. Later profile or settings changes cause conflict and are never overwritten. Inspect the result before retrying an unknown outcome.",
    parameters: { type: "object", properties: { transactionId: string(128) }, required: ["transactionId"], additionalProperties: false },
    execute: (params) => {
      fields(params, ["transactionId"]);
      return undoProfile(ctx, text(params.transactionId, 128));
    }
  });
}

// src/strings.ts
var en = {
  title: "Workspace Profiles",
  description: "Save the current shelf, appearance and reading setup as a named profile and switch between them.",
  save: "Save current workspace",
  name: "Profile name",
  namePlaceholder: "Evening reading",
  invalid: "Enter a name of 1–80 characters.",
  empty: "No profiles yet. Save the current workspace to create one.",
  apply: "Apply",
  rename: "Rename",
  remove: "Delete",
  refresh: "Refresh",
  saved: "Profile saved",
  renamed: "Profile renamed",
  applied: "Profile applied",
  undo: "Undo",
  undone: "Previous settings restored",
  conflict: "This profile or your settings changed in the meantime. Reload and try again.",
  missing: "This profile no longer exists.",
  invalidProfile: "Unreadable profile",
  stalePage: "The profile list changed. Reload it.",
  confirmDelete: "Delete this profile permanently",
  confirmRequired: "Confirm the deletion first.",
  deleted: "Profile deleted",
  appDefault: "App default",
  on: "On",
  off: "Off",
  savedAt: "Saved",
  settings: "Settings",
  back: "All profiles"
};
var translations = {
  en,
  "zh-Hans": {
    title: "工作区预设",
    description: "把当前书架、外观和阅读设置保存为一个命名预设，随时切换。",
    save: "保存当前工作区",
    name: "预设名称",
    namePlaceholder: "夜间阅读",
    invalid: "请输入 1–80 个字符的名称。",
    empty: "还没有预设。保存当前工作区即可创建。",
    apply: "应用",
    rename: "重命名",
    remove: "删除",
    refresh: "刷新",
    saved: "预设已保存",
    renamed: "预设已重命名",
    applied: "预设已应用",
    undo: "撤销",
    undone: "已恢复之前的设置",
    conflict: "预设或你的设置在此期间有变化，请刷新后再试。",
    missing: "这个预设已不存在。",
    invalidProfile: "无法读取的预设",
    stalePage: "预设列表已变化，请刷新。",
    confirmDelete: "永久删除这个预设",
    confirmRequired: "请先确认删除。",
    deleted: "预设已删除",
    appDefault: "应用默认",
    on: "开",
    off: "关",
    savedAt: "保存于",
    settings: "设置",
    back: "全部预设"
  },
  "zh-Hant": {
    title: "工作區預設",
    description: "把目前書架、外觀和閱讀設定儲存為一個命名預設，隨時切換。",
    save: "儲存目前工作區",
    name: "預設名稱",
    namePlaceholder: "夜間閱讀",
    invalid: "請輸入 1–80 個字元的名稱。",
    empty: "還沒有預設。儲存目前工作區即可建立。",
    apply: "套用",
    rename: "重新命名",
    remove: "刪除",
    refresh: "重新整理",
    saved: "預設已儲存",
    renamed: "預設已重新命名",
    applied: "預設已套用",
    undo: "復原",
    undone: "已恢復先前的設定",
    conflict: "預設或你的設定在此期間有變化，請重新整理後再試。",
    missing: "這個預設已不存在。",
    invalidProfile: "無法讀取的預設",
    stalePage: "預設清單已變化，請重新整理。",
    confirmDelete: "永久刪除這個預設",
    confirmRequired: "請先確認刪除。",
    deleted: "預設已刪除",
    appDefault: "應用程式預設",
    on: "開",
    off: "關",
    savedAt: "儲存於",
    settings: "設定",
    back: "全部預設"
  },
  ja: {
    title: "ワークスペースプロファイル",
    description: "現在の本棚・外観・読書設定に名前を付けて保存し、いつでも切り替えられます。",
    save: "現在のワークスペースを保存",
    name: "プロファイル名",
    namePlaceholder: "夜の読書",
    invalid: "1〜80文字の名前を入力してください。",
    empty: "プロファイルはまだありません。現在のワークスペースを保存して作成します。",
    apply: "適用",
    rename: "名前を変更",
    remove: "削除",
    refresh: "更新",
    saved: "プロファイルを保存しました",
    renamed: "プロファイル名を変更しました",
    applied: "プロファイルを適用しました",
    undo: "元に戻す",
    undone: "以前の設定に戻しました",
    conflict: "その間にプロファイルまたは設定が変更されました。再読み込みしてやり直してください。",
    missing: "このプロファイルはもう存在しません。",
    invalidProfile: "読み取れないプロファイル",
    stalePage: "プロファイル一覧が変わりました。再読み込みしてください。",
    confirmDelete: "このプロファイルを完全に削除する",
    confirmRequired: "先に削除を確認してください。",
    deleted: "プロファイルを削除しました",
    appDefault: "アプリの既定",
    on: "オン",
    off: "オフ",
    savedAt: "保存日時",
    settings: "設定",
    back: "すべてのプロファイル"
  },
  de: {
    title: "Arbeitsbereich-Profile",
    description: "Speichern Sie Regal, Erscheinungsbild und Leseeinstellungen als benanntes Profil und wechseln Sie jederzeit.",
    save: "Aktuellen Arbeitsbereich speichern",
    name: "Profilname",
    namePlaceholder: "Abendlektüre",
    invalid: "Geben Sie einen Namen mit 1–80 Zeichen ein.",
    empty: "Noch keine Profile. Speichern Sie den aktuellen Arbeitsbereich, um eines anzulegen.",
    apply: "Anwenden",
    rename: "Umbenennen",
    remove: "Löschen",
    refresh: "Aktualisieren",
    saved: "Profil gespeichert",
    renamed: "Profil umbenannt",
    applied: "Profil angewendet",
    undo: "Rückgängig",
    undone: "Vorherige Einstellungen wiederhergestellt",
    conflict: "Das Profil oder Ihre Einstellungen haben sich inzwischen geändert. Laden Sie neu und versuchen Sie es erneut.",
    missing: "Dieses Profil existiert nicht mehr.",
    invalidProfile: "Unlesbares Profil",
    stalePage: "Die Profilliste hat sich geändert. Laden Sie sie neu.",
    confirmDelete: "Dieses Profil dauerhaft löschen",
    confirmRequired: "Bestätigen Sie zuerst das Löschen.",
    deleted: "Profil gelöscht",
    appDefault: "App-Standard",
    on: "Ein",
    off: "Aus",
    savedAt: "Gespeichert",
    settings: "Einstellungen",
    back: "Alle Profile"
  },
  fr: {
    title: "Profils d’espace de travail",
    description: "Enregistrez l’étagère, l’apparence et les réglages de lecture actuels sous un nom et passez de l’un à l’autre.",
    save: "Enregistrer l’espace de travail actuel",
    name: "Nom du profil",
    namePlaceholder: "Lecture du soir",
    invalid: "Saisissez un nom de 1 à 80 caractères.",
    empty: "Aucun profil pour l’instant. Enregistrez l’espace de travail actuel pour en créer un.",
    apply: "Appliquer",
    rename: "Renommer",
    remove: "Supprimer",
    refresh: "Actualiser",
    saved: "Profil enregistré",
    renamed: "Profil renommé",
    applied: "Profil appliqué",
    undo: "Annuler",
    undone: "Réglages précédents restaurés",
    conflict: "Le profil ou vos réglages ont changé entre-temps. Rechargez et réessayez.",
    missing: "Ce profil n’existe plus.",
    invalidProfile: "Profil illisible",
    stalePage: "La liste des profils a changé. Rechargez-la.",
    confirmDelete: "Supprimer définitivement ce profil",
    confirmRequired: "Confirmez d’abord la suppression.",
    deleted: "Profil supprimé",
    appDefault: "Valeur par défaut",
    on: "Activé",
    off: "Désactivé",
    savedAt: "Enregistré",
    settings: "Réglages",
    back: "Tous les profils"
  },
  es: {
    title: "Perfiles de espacio de trabajo",
    description: "Guarda la estantería, la apariencia y los ajustes de lectura actuales con un nombre y cambia entre ellos cuando quieras.",
    save: "Guardar espacio de trabajo actual",
    name: "Nombre del perfil",
    namePlaceholder: "Lectura nocturna",
    invalid: "Escribe un nombre de 1 a 80 caracteres.",
    empty: "Aún no hay perfiles. Guarda el espacio de trabajo actual para crear uno.",
    apply: "Aplicar",
    rename: "Renombrar",
    remove: "Eliminar",
    refresh: "Actualizar",
    saved: "Perfil guardado",
    renamed: "Perfil renombrado",
    applied: "Perfil aplicado",
    undo: "Deshacer",
    undone: "Ajustes anteriores restaurados",
    conflict: "El perfil o tus ajustes cambiaron mientras tanto. Recarga e inténtalo de nuevo.",
    missing: "Este perfil ya no existe.",
    invalidProfile: "Perfil ilegible",
    stalePage: "La lista de perfiles cambió. Recárgala.",
    confirmDelete: "Eliminar este perfil de forma permanente",
    confirmRequired: "Confirma primero la eliminación.",
    deleted: "Perfil eliminado",
    appDefault: "Valor predeterminado",
    on: "Activado",
    off: "Desactivado",
    savedAt: "Guardado",
    settings: "Ajustes",
    back: "Todos los perfiles"
  },
  ru: {
    title: "Профили рабочего пространства",
    description: "Сохраните текущие настройки полки, оформления и чтения как именованный профиль и переключайтесь между ними.",
    save: "Сохранить текущее пространство",
    name: "Название профиля",
    namePlaceholder: "Вечернее чтение",
    invalid: "Введите название длиной от 1 до 80 символов.",
    empty: "Профилей пока нет. Сохраните текущее пространство, чтобы создать первый.",
    apply: "Применить",
    rename: "Переименовать",
    remove: "Удалить",
    refresh: "Обновить",
    saved: "Профиль сохранён",
    renamed: "Профиль переименован",
    applied: "Профиль применён",
    undo: "Отменить",
    undone: "Прежние настройки восстановлены",
    conflict: "Профиль или ваши настройки тем временем изменились. Обновите и попробуйте снова.",
    missing: "Этого профиля больше нет.",
    invalidProfile: "Нечитаемый профиль",
    stalePage: "Список профилей изменился. Обновите его.",
    confirmDelete: "Удалить этот профиль навсегда",
    confirmRequired: "Сначала подтвердите удаление.",
    deleted: "Профиль удалён",
    appDefault: "По умолчанию",
    on: "Вкл.",
    off: "Выкл.",
    savedAt: "Сохранено",
    settings: "Настройки",
    back: "Все профили"
  }
};
var copy = (locale) => translations[locale] ?? translations[locale.split("-")[0]] ?? (locale.startsWith("zh") ? translations["zh-Hans"] : en);

// src/views.ts
function valueText(ctx, entry) {
  const t = copy(ctx.locale);
  if (entry.value === null)
    return t.appDefault;
  if (typeof entry.value === "boolean")
    return entry.value ? t.on : t.off;
  return entry.valueLabel ?? String(entry.value);
}
function message(ctx, text2) {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text: text2 }], actions: [
    { id: "back", label: t.back, icon: "cards", priority: "primary", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) }
  ] };
}
function saveForm(ctx) {
  const t = copy(ctx.locale);
  return {
    kind: "form",
    title: t.save,
    submitLabel: t.save,
    fields: [{ kind: "text", id: "name", label: t.name, value: "", placeholder: t.namePlaceholder }],
    onSubmit: async (values) => {
      let name;
      try {
        name = profileName(values.name);
      } catch {
        return { fieldErrors: { name: t.invalid } };
      }
      const result = await saveProfile(ctx, name);
      if (result.status !== "saved")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profileView(ctx, result.id), navigation: "reset", toast: t.saved };
    }
  };
}
function renameForm(ctx, doc, currentName) {
  const t = copy(ctx.locale);
  return {
    kind: "form",
    title: t.rename,
    submitLabel: t.rename,
    fields: [{ kind: "text", id: "name", label: t.name, value: currentName }],
    onSubmit: async (values) => {
      let name;
      try {
        name = profileName(values.name);
      } catch {
        return { fieldErrors: { name: t.invalid } };
      }
      const result = await renameProfile(ctx, doc.id, name, doc.revision);
      if (result.status !== "renamed")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profileView(ctx, doc.id), navigation: "replace", toast: t.renamed };
    }
  };
}
function deleteForm(ctx, doc, name) {
  const t = copy(ctx.locale);
  return {
    kind: "form",
    title: name,
    submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirmDelete, value: false }],
    onSubmit: async (values) => {
      if (values.confirm !== true)
        return { fieldErrors: { confirm: t.confirmRequired } };
      const result = await deleteProfile(ctx, doc.id, doc.revision);
      if (result.status !== "deleted")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profilesView(ctx), navigation: "reset", toast: t.deleted };
    }
  };
}
function appliedView(ctx, id, name, transactionId) {
  const t = copy(ctx.locale);
  return { kind: "detail", title: name, content: [{ kind: "alert", variant: "success", message: t.applied }], actions: [
    { id: "undo", label: t.undo, icon: "arrow-counter-clockwise", priority: "primary", run: async () => {
      await undoProfile(ctx, transactionId);
      return { view: await profilesView(ctx), navigation: "reset", toast: t.undone };
    } },
    { id: "back", label: t.back, icon: "cards", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) },
    { id: "profile", label: name, icon: "cards", priority: "secondary", run: async () => ({ view: await profileView(ctx, id), navigation: "reset" }) }
  ] };
}
async function profileView(ctx, id) {
  const t = copy(ctx.locale);
  const doc = await profileCollection(ctx).get(id);
  if (!doc)
    return message(ctx, t.missing);
  const profile = parseProfile(doc.data);
  const name = profile?.name ?? t.invalidProfile;
  const description = profile ? await describeProfile(ctx, profile) : null;
  const actions = [];
  if (profile) {
    actions.push({ id: "apply", label: t.apply, icon: "check", variant: "solid", priority: "primary", run: async () => {
      const result = await applyProfile(ctx, id, doc.revision);
      if (result.status !== "applied")
        return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: appliedView(ctx, id, profile.name, result.transactionId), navigation: "replace" };
    } });
    actions.push({ id: "rename", label: t.rename, icon: "pencil-simple", priority: "secondary", run: () => ({ view: renameForm(ctx, doc, profile.name) }) });
  }
  actions.push({ id: "delete", label: t.remove, icon: "trash", variant: "danger", priority: "secondary", run: () => ({ view: deleteForm(ctx, doc, name) }) }, { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await profileView(ctx, id), navigation: "replace" }) });
  return {
    kind: "detail",
    title: name,
    metadata: [{ kind: "label", label: t.savedAt, value: new Date(doc.updatedAt).toLocaleString(ctx.locale), icon: "clock" }],
    content: description ? [{ kind: "keyValue", rows: description.entries.map((entry) => ({ label: entry.label, value: valueText(ctx, entry) })) }] : [{ kind: "alert", variant: "destructive", message: t.invalidProfile }],
    actions
  };
}
async function profilesView(ctx, cursors = [undefined]) {
  const t = copy(ctx.locale);
  const page = await listProfiles(ctx, cursors[cursors.length - 1]);
  if (page.status === "stale-cursor")
    return message(ctx, t.stalePage);
  const go = async (next) => ({ view: await profilesView(ctx, next), navigation: "replace" });
  const items = await Promise.all(page.items.map(async (doc) => {
    const profile = parseProfile(doc.data);
    const description = profile ? await describeProfile(ctx, profile) : null;
    return {
      id: doc.id,
      title: profile?.name ?? t.invalidProfile,
      icon: "cards",
      subtitle: description?.summary.map((entry) => valueText(ctx, entry)).join(" · "),
      timestamp: doc.updatedAt,
      onSelect: async () => ({ view: await profileView(ctx, doc.id) })
    };
  }));
  return { kind: "list", title: t.title, emptyText: t.empty, items, actions: [
    { id: "save", label: t.save, icon: "plus", variant: "solid", priority: "primary", run: () => ({ view: saveForm(ctx) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) }
  ], pagination: {
    page: cursors.length,
    ...cursors.length > 1 ? { onPrevious: () => go(cursors.slice(0, -1)) } : {},
    ...page.nextCursor ? { onNext: () => go([...cursors, page.nextCursor]) } : {}
  } };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "profiles", title, icon: "cards", surface: "shelf", presentation: "popup", view: () => profilesView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "cards", run: async () => ({ view: await profilesView(ctx) }) });
    registerProfileTools(ctx);
  }
};
export {
  src_default as default
};
