// src/goals.ts
var key = (bookId) => `goal:${bookId}`;
var invalid = () => {
  throw Object.assign(Error("Invalid reading goal"), { code: "plugin/invalid-input" });
};
function goalBookId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    return invalid();
  return value;
}
function parseGoal(value) {
  if (!value || typeof value !== "object")
    return invalid();
  const goal = value;
  if (typeof goal.text !== "string" || !goal.text.trim() || goal.text.trim().length > 500 || typeof goal.suggestMemory !== "boolean")
    return invalid();
  return { text: goal.text.trim(), suggestMemory: goal.suggestMemory };
}
async function readGoalState(ctx, input) {
  const bookId = goalBookId(input), storage = ctx.services.storage, collection = storage.collection("goals");
  let doc = await collection.get(bookId);
  if (!doc) {
    await storage.flush();
    const legacy = await storage.getDurable(key(bookId));
    if (legacy !== null) {
      const goal2 = parseGoal(legacy);
      await storage.applyDocuments([{
        kind: "put",
        collection: "goals",
        id: bookId,
        bookId,
        data: { version: 1, goal: goal2 },
        expectedRevision: null
      }]);
      doc = await collection.get(bookId);
      if (!doc)
        throw Object.assign(Error("Goal promotion disappeared"), { code: "plugin/unavailable" });
    }
  }
  if (!doc)
    return { bookId, goal: null, revision: null };
  if (doc.data?.version !== 1)
    return invalid();
  const goal = doc.data.goal === null ? null : parseGoal(doc.data.goal);
  if (await storage.getDurable(key(bookId)) !== null)
    await storage.remove(key(bookId));
  return { bookId, goal, revision: doc.revision };
}
async function readGoal(ctx, bookId) {
  return (await readGoalState(ctx, bookId)).goal;
}
async function writeGoal(ctx, input, goal, expectedRevision) {
  const bookId = goalBookId(input), value = goal === null ? null : parseGoal(goal);
  if (expectedRevision !== null && (typeof expectedRevision !== "string" || !expectedRevision.trim() || expectedRevision.length > 512))
    return invalid();
  if (value !== null && !await ctx.domains.library.queries.books.get(bookId)) {
    throw Object.assign(Error("Goal book is no longer available"), { code: "library/book-not-found" });
  }
  const receipt = await ctx.services.storage.applyDocuments([{
    kind: "put",
    collection: "goals",
    id: bookId,
    bookId,
    data: { version: 1, goal: value },
    expectedRevision
  }]);
  return { status: receipt.status === "conflict" ? "conflict" : value === null ? "cleared" : "saved", bookId };
}

// src/strings.ts
var en = {
  title: "Reading Goals",
  goal: "What do you want to get out of this book?",
  goalPlaceholder: "Understand the author's main argument well enough to explain it to a friend.",
  goalHelp: "The assistant sees this goal whenever you chat inside this book.",
  remember: "Also suggest this goal for long-term memory",
  save: "Save goal",
  clear: "Clear goal",
  noBook: "Open a book to set a reading goal for it.",
  invalid: "Enter a goal of 1 to 500 characters.",
  refresh: "Refresh",
  saved: "Goal saved",
  cleared: "Goal cleared",
  conflict: "This goal changed elsewhere. Reload before trying again.",
  confirm: "Clear the reading goal for this book",
  required: "Confirm clearing first.",
  memoryOff: "Long-term memory is turned off in Settings → AI, so the goal will not be suggested for memory until you turn it on.",
  bookMissing: "This book is no longer in your library."
};
var copies = {
  en,
  "zh-Hans": {
    title: "阅读目标",
    goal: "你想从这本书里得到什么？",
    goalPlaceholder: "把作者的核心论点搞清楚，能讲给朋友听。",
    goalHelp: "在这本书里聊天时，助手会看到这个目标。",
    remember: "同时把这个目标推荐进长期记忆",
    save: "保存目标",
    clear: "清除目标",
    noBook: "打开一本书，再为它设定阅读目标。",
    invalid: "请输入 1 至 500 个字符的目标。",
    refresh: "刷新",
    saved: "目标已保存",
    cleared: "目标已清除",
    conflict: "这个目标在别处被修改了，请刷新后再试。",
    confirm: "清除这本书的阅读目标",
    required: "请先确认清除。",
    memoryOff: "长期记忆已在“设置 → AI”中关闭，打开之前不会推荐这个目标进记忆。",
    bookMissing: "这本书已不在你的书库中。"
  },
  "zh-Hant": {
    title: "閱讀目標",
    goal: "你想從這本書得到什麼？",
    goalPlaceholder: "把作者的核心論點弄清楚，能講給朋友聽。",
    goalHelp: "在這本書裡聊天時，助理會看到這個目標。",
    remember: "同時把這個目標推薦進長期記憶",
    save: "儲存目標",
    clear: "清除目標",
    noBook: "開啟一本書，再為它設定閱讀目標。",
    invalid: "請輸入 1 至 500 個字元的目標。",
    refresh: "重新整理",
    saved: "目標已儲存",
    cleared: "目標已清除",
    conflict: "這個目標在別處被修改了，請重新整理後再試。",
    confirm: "清除這本書的閱讀目標",
    required: "請先確認清除。",
    memoryOff: "長期記憶已在「設定 → AI」中關閉，開啟之前不會推薦這個目標進記憶。",
    bookMissing: "這本書已不在你的書庫中。"
  },
  ja: {
    title: "読書目標",
    goal: "この本から何を得たいですか？",
    goalPlaceholder: "著者の主張を友人に説明できるくらい理解する。",
    goalHelp: "この本の中でチャットするとき、アシスタントはこの目標を参照します。",
    remember: "この目標を長期メモリにも提案する",
    save: "目標を保存",
    clear: "目標を削除",
    noBook: "本を開いてから読書目標を設定してください。",
    invalid: "1〜500文字の目標を入力してください。",
    refresh: "更新",
    saved: "目標を保存しました",
    cleared: "目標を削除しました",
    conflict: "この目標は別の場所で変更されました。再読み込みしてやり直してください。",
    confirm: "この本の読書目標を削除する",
    required: "先に削除を確認してください。",
    memoryOff: "長期メモリは「設定 → AI」でオフになっています。オンにするまでこの目標はメモリに提案されません。",
    bookMissing: "この本はもうライブラリにありません。"
  },
  de: {
    title: "Leseziele",
    goal: "Was möchten Sie aus diesem Buch mitnehmen?",
    goalPlaceholder: "Das Hauptargument des Autors so gut verstehen, dass ich es einem Freund erklären kann.",
    goalHelp: "Der Assistent sieht dieses Ziel bei jedem Gespräch in diesem Buch.",
    remember: "Dieses Ziel auch für das Langzeitgedächtnis vorschlagen",
    save: "Ziel speichern",
    clear: "Ziel löschen",
    noBook: "Öffnen Sie ein Buch, um ein Leseziel dafür festzulegen.",
    invalid: "Geben Sie ein Ziel mit 1 bis 500 Zeichen ein.",
    refresh: "Aktualisieren",
    saved: "Ziel gespeichert",
    cleared: "Ziel gelöscht",
    conflict: "Dieses Ziel wurde anderswo geändert. Laden Sie neu und versuchen Sie es erneut.",
    confirm: "Das Leseziel für dieses Buch löschen",
    required: "Bestätigen Sie zuerst das Löschen.",
    memoryOff: "Das Langzeitgedächtnis ist unter Einstellungen → KI ausgeschaltet. Bis Sie es einschalten, wird das Ziel nicht für das Gedächtnis vorgeschlagen.",
    bookMissing: "Dieses Buch ist nicht mehr in Ihrer Bibliothek."
  },
  fr: {
    title: "Objectifs de lecture",
    goal: "Que voulez-vous retirer de ce livre ?",
    goalPlaceholder: "Comprendre l’argument principal de l’auteur assez bien pour l’expliquer à un ami.",
    goalHelp: "L’assistant voit cet objectif à chaque conversation dans ce livre.",
    remember: "Proposer aussi cet objectif pour la mémoire à long terme",
    save: "Enregistrer l’objectif",
    clear: "Effacer l’objectif",
    noBook: "Ouvrez un livre pour lui définir un objectif de lecture.",
    invalid: "Saisissez un objectif de 1 à 500 caractères.",
    refresh: "Actualiser",
    saved: "Objectif enregistré",
    cleared: "Objectif effacé",
    conflict: "Cet objectif a été modifié ailleurs. Rechargez avant de réessayer.",
    confirm: "Effacer l’objectif de lecture de ce livre",
    required: "Confirmez d’abord l’effacement.",
    memoryOff: "La mémoire à long terme est désactivée dans Réglages → IA ; l’objectif ne sera pas proposé pour la mémoire tant qu’elle est désactivée.",
    bookMissing: "Ce livre n’est plus dans votre bibliothèque."
  },
  es: {
    title: "Objetivos de lectura",
    goal: "¿Qué quieres sacar de este libro?",
    goalPlaceholder: "Entender el argumento principal del autor lo bastante bien como para explicárselo a un amigo.",
    goalHelp: "El asistente ve este objetivo cada vez que conversas dentro de este libro.",
    remember: "Proponer también este objetivo para la memoria a largo plazo",
    save: "Guardar objetivo",
    clear: "Borrar objetivo",
    noBook: "Abre un libro para fijarle un objetivo de lectura.",
    invalid: "Escribe un objetivo de 1 a 500 caracteres.",
    refresh: "Actualizar",
    saved: "Objetivo guardado",
    cleared: "Objetivo borrado",
    conflict: "Este objetivo cambió en otro lugar. Recarga antes de reintentar.",
    confirm: "Borrar el objetivo de lectura de este libro",
    required: "Confirma primero el borrado.",
    memoryOff: "La memoria a largo plazo está desactivada en Ajustes → IA; el objetivo no se propondrá para la memoria hasta que la actives.",
    bookMissing: "Este libro ya no está en tu biblioteca."
  },
  ru: {
    title: "Цели чтения",
    goal: "Что вы хотите вынести из этой книги?",
    goalPlaceholder: "Понять главный аргумент автора настолько, чтобы объяснить его другу.",
    goalHelp: "Ассистент видит эту цель в каждом разговоре внутри этой книги.",
    remember: "Также предложить эту цель для долговременной памяти",
    save: "Сохранить цель",
    clear: "Удалить цель",
    noBook: "Откройте книгу, чтобы задать для неё цель чтения.",
    invalid: "Введите цель длиной от 1 до 500 символов.",
    refresh: "Обновить",
    saved: "Цель сохранена",
    cleared: "Цель удалена",
    conflict: "Эта цель была изменена в другом месте. Обновите и попробуйте снова.",
    confirm: "Удалить цель чтения для этой книги",
    required: "Сначала подтвердите удаление.",
    memoryOff: "Долговременная память выключена в «Настройки → ИИ»; пока она выключена, цель не будет предлагаться для памяти.",
    bookMissing: "Этой книги больше нет в вашей библиотеке."
  }
};
function copy(locale) {
  return copies[locale] ?? copies[locale.split("-")[0]] ?? (locale.startsWith("zh") ? copies["zh-Hans"] : en);
}

// src/views.ts
function notice(ctx, text, bookId) {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text, tone: "muted" }], actions: bookId ? [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "primary", run: async () => ({ view: await goalsView(ctx, bookId), navigation: "replace" }) }
  ] : [] };
}
async function goalsView(ctx, bookId) {
  const t = copy(ctx.locale);
  const target = bookId ?? (await ctx.domains.reading.queries.session()).bookId;
  if (!target)
    return notice(ctx, t.noBook);
  const book = await ctx.domains.library.queries.books.get(target);
  if (!book)
    return notice(ctx, t.bookMissing);
  const { goal, revision } = await readGoalState(ctx, target);
  const memoryEnabled = (await ctx.domains.settings.queries.read("ai.preferences.buildMemory")).value === true;
  const refresh = async (toast) => ({ view: await goalsView(ctx, target), navigation: "replace", ...toast ? { toast } : {} });
  const goalForm = {
    kind: "form",
    submitLabel: t.save,
    fields: [
      { kind: "textarea", id: "goal", label: t.goal, value: goal?.text ?? "", rows: 4, placeholder: t.goalPlaceholder, helperText: t.goalHelp },
      { kind: "checkbox", id: "suggestMemory", label: t.remember, value: goal?.suggestMemory ?? false }
    ],
    onSubmit: async (values) => {
      const text = typeof values.goal === "string" ? values.goal.trim() : "";
      if (!text || text.length > 500)
        return { fieldErrors: { goal: t.invalid } };
      if (typeof values.suggestMemory !== "boolean")
        return { fieldErrors: { suggestMemory: t.invalid } };
      const result = await writeGoal(ctx, target, { text, suggestMemory: values.suggestMemory }, revision);
      if (result.status !== "saved")
        return { view: notice(ctx, t.conflict, target), navigation: "replace" };
      return refresh(t.saved);
    }
  };
  const blocks = [
    { kind: "heading", text: book.title, ...book.author ? { caption: book.author } : {} },
    goalForm
  ];
  if (goal?.suggestMemory && !memoryEnabled)
    blocks.push({ kind: "alert", message: t.memoryOff });
  const actions = [];
  if (goal)
    actions.push({ id: "clear", label: t.clear, icon: "trash", variant: "danger", priority: "secondary", run: () => ({ view: {
      kind: "form",
      title: t.clear,
      submitLabel: t.clear,
      fields: [{ kind: "checkbox", id: "confirm", label: t.confirm, value: false }],
      onSubmit: async (values) => {
        if (values.confirm !== true)
          return { fieldErrors: { confirm: t.required } };
        const result = await writeGoal(ctx, target, null, revision);
        if (result.status !== "cleared")
          return { view: notice(ctx, t.conflict, target), navigation: "replace" };
        return refresh(t.cleared);
      }
    } }) });
  actions.push({ id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: () => refresh() });
  blocks.push({ kind: "actions", actions, align: "end" });
  return { kind: "blocks", title: t.title, blocks };
}

// src/tools.ts
var invalid2 = () => {
  throw Object.assign(Error("Invalid reading goal tool input"), { code: "plugin/invalid-input" });
};
function fields(params, allowed) {
  if (Object.keys(params).some((key2) => !allowed.includes(key2)))
    invalid2();
}
var bookIdSchema = { type: "string", minLength: 1, maxLength: 512 };
var revisionSchema = { anyOf: [bookIdSchema, { type: "null" }] };
function revision(value) {
  if (value === null)
    return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    return invalid2();
  return value;
}
function registerGoalTools(ctx) {
  if (!ctx.contributions.agentTools)
    throw Error("Reading Goals requires agent:tools");
  const t = copy(ctx.locale);
  ctx.contributions.agentTools.register({
    name: "get_reading_goal",
    label: t.title,
    contexts: ["book", "global"],
    description: "Read this plugin's saved goal and revision for an exact bookId, independent of the currently open reader. A null goal means no active goal; preserve its returned revision, including null, for subsequent writes. Legacy goals are promoted into versioned private documents on first access. Does not retrieve book text or create user memory.",
    parameters: { type: "object", properties: { bookId: bookIdSchema }, required: ["bookId"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId"]);
      return readGoalState(ctx, goalBookId(params.bookId));
    }
  });
  ctx.contributions.agentTools.register({
    name: "set_reading_goal",
    label: t.save,
    contexts: ["book", "global"],
    approval: "required",
    description: "Save or replace a book's private reading goal after host approval of the exact text, bookId and suggestMemory flag. First get_reading_goal and pass its expectedRevision (null only for an absent record). Changed records return conflict. Text is 1..500 characters. suggestMemory must be explicit: true only opts this goal into the existing host-reviewed memory-candidate pipeline; it does not directly write memory or enable Build memory. The goal supplies context on subsequent book turns. Never edits the book, reading history, privacy settings or existing memories.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, text: { type: "string", minLength: 1, maxLength: 500 }, suggestMemory: { type: "boolean" }, expectedRevision: revisionSchema }, required: ["bookId", "text", "suggestMemory", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "text", "suggestMemory", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      const goal = parseGoal({ text: params.text, suggestMemory: params.suggestMemory });
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, goal, expectedRevision);
    }
  });
  ctx.contributions.agentTools.register({
    name: "clear_reading_goal",
    label: t.clear,
    contexts: ["book", "global"],
    approval: "required",
    description: "Clear one private reading goal after host approval. First get_reading_goal and pass its exact expectedRevision; conflicts do not erase newer edits. A cleared record retains a versioned tombstone to prevent legacy goal resurrection. Stops future goal context/candidates but does not retract memory already accepted by the host or cancel a running turn. Can clear an orphaned goal after its book has been removed. Does not remove the book or change memory policy.",
    parameters: { type: "object", properties: { bookId: bookIdSchema, expectedRevision: revisionSchema }, required: ["bookId", "expectedRevision"], additionalProperties: false },
    execute: async (params) => {
      fields(params, ["bookId", "expectedRevision"]);
      const bookId = goalBookId(params.bookId), expectedRevision = revision(params.expectedRevision);
      await readGoalState(ctx, bookId);
      return writeGoal(ctx, bookId, null, expectedRevision);
    }
  });
}

// src/memory-status.ts
function registerGoalMemory(ctx) {
  const provider = {
    id: "reading-goal",
    contexts: ["book"],
    async propose({ scope }) {
      if (scope.kind !== "book")
        return [];
      const state = await readGoalState(ctx, scope.bookId);
      if (!state.goal?.suggestMemory)
        return [];
      return [{ scope: "book", kind: "preference", content: state.goal.text }];
    }
  };
  ctx.contributions.memoryCandidateProviders.register(provider);
  return provider;
}

// src/context-source.ts
function readingGoalSource(ctx) {
  const book = (scope) => {
    if (scope.kind !== "book")
      throw Object.assign(Error("Reading Goals has no user-wide intention"), { code: "plugin/invalid-input" });
    return goalBookId(scope.id);
  };
  return {
    scopes: ["book"],
    prepare: async (scope) => {
      await readGoalState(ctx, book(scope));
      await ctx.services.storage.flush();
    },
    read: async (scope) => {
      const id = book(scope), storage = ctx.services.storage;
      const doc = await storage.collection("goals").get(id);
      if (!doc) {
        if (await storage.getDurable(`goal:${id}`) !== null)
          throw Object.assign(Error("Goal migration required before capture"), { code: "memory/conflict" });
        return { revision: null, text: null };
      }
      if (doc.data?.version !== 1)
        throw Object.assign(Error("Invalid reading goal record"), { code: "plugin/invalid-input" });
      return { revision: doc.revision, text: doc.data.goal === null ? null : parseGoal(doc.data.goal).text };
    }
  };
}

// src/index.ts
var src_default = {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders)
      throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "target", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "target", keywords: "goal intention purpose", run: async () => ({ view: await goalsView(ctx) }) });
    registerGoalTools(ctx);
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], readingIntent: readingGoalSource(ctx), provide: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    registerGoalMemory(ctx);
  },
  migrate(_ctx, migration) {
    if (migration.direction !== "upgrade" || migration.fromVersion > 1 || migration.toVersion !== 2)
      throw Error("Unsupported Reading Goals schema migration");
  }
};
export {
  src_default as default
};
