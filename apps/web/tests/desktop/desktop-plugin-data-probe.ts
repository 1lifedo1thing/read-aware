import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { installPluginFiles, uninstallPlugin } from "../../src/features/plugins/runtime/plugin-host";
import { listPluginEntries } from "../../src/features/plugins/runtime/plugin-backend";
import { snapshotPluginData, PLUGIN_SCHEMA_KEY_PREFIX } from "../../src/features/plugins/runtime/plugin-data-snapshot";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { localKV } from "../../src/platform/local-store";
import { deletePluginSecret } from "../../src/platform/secret-store";
import { parseProbeToast } from "./probe-toast";

const id = "capability-data-transaction";
// Executable JS is installed through the same native file transaction as a
// marketplace package, so migration does not use a fake storage adapter.
const source = String.raw`
export default {
  activate(ctx) {
    const storage = ctx.services.storage, docs = storage.collection('words');
    let observations = [], observation;
    const commands = {
      seed: async () => {
        const pending = storage.set('mirror', {value: 'durable'});
        const immediate = storage.get('mirror');
        await pending;
        for (let i = 0; i < 3; i++) await docs.put('word'+i, {label: 'École 中文', ordinal: i});
        await ctx.services.secrets.set('probe', 'synthetic-plugin-secret');
        return {immediate, durable: await storage.getDurable('mirror'), secretMatches: await ctx.services.secrets.get('probe') === 'synthetic-plugin-secret'};
      },
      observe: async () => {
        observation = storage.observeDocuments({collection:'words',kind:'get',id:'word0'}, event => observations.push(event));
        return {subscribed:true};
      },
      documents: async () => {
        const first = await docs.page({limit:1, query:'école 中文'});
        if (first.status !== 'ready' || !first.nextCursor) throw Error('Expected paged search');
        const second = await docs.page({limit:1, query:'école 中文',cursor:first.nextCursor});
        const a = await docs.get('word0'), b = await docs.get('word1');
        const conflict = await storage.applyDocuments([
          {kind:'put',collection:'words',id:'would-leak',data:{leak:true},expectedRevision:null},
          {kind:'check',collection:'words',id:'word0',expectedRevision:b.revision}
        ]);
        const absentAfterConflict = await docs.get('would-leak') === null;
        const applied = await storage.applyDocuments([
          {kind:'put',collection:'words',id:'word0',data:{label:'Corrected 中文'},expectedRevision:a.revision},
          {kind:'delete',collection:'words',id:'word1',expectedRevision:b.revision}
        ]);
        return {first,second,conflict,absentAfterConflict,applied,
          stale:await docs.page({limit:1,query:'école 中文',cursor:first.nextCursor}),
          literalWildcard:await docs.page({query:'%'}), remaining:await docs.list()};
      },
      inspect: async () => ({version:ctx.manifest.version, schema:ctx.manifest.schemaVersion,
        mirror:storage.get('mirror'), durable:await storage.getDurable('mirror'),
        migration:await storage.getDurable('migration'), documents:await docs.list(),
        secretMatches:await ctx.services.secrets.get('probe') === 'synthetic-plugin-secret',
        observations,policy:await storage.policy()}),
      stopObservation: async () => { observation?.dispose(); observation=undefined; return {count:observations.length}; },
      removeSecret: async () => { await ctx.services.secrets.remove('probe'); return {absent:await ctx.services.secrets.get('probe') === null}; },
    };
    for(const [id,run] of Object.entries(commands)) ctx.contributions.commands.register({id,title:id,run:async()=>({toast:JSON.stringify(await run())})});
  },
  async migrate(ctx,migration) {
    await ctx.storage.set('migration', {toVersion:migration.toVersion});
    await ctx.storage.collection('words').put('migration', {schema:migration.toVersion});
    if(ctx.manifest.description === 'fail') throw Error('Intentional migration failure after writes');
  }
};`;

async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated capability-e2e required");
}
export async function preparePluginDataProbe() {
  await isolated();
  const existing = await snapshotPluginData(id);
  if ((await listPluginEntries()).some(entry => entry.id === id) || Object.keys(existing.kv).length || existing.documents.length || existing.schema) throw Error("Owned plugin namespace must be empty");
  return installPluginDataProbe("initial");
}
export async function installPluginDataProbe(mode: "initial" | "fail" | "success") {
  await isolated();
  const manifest = {id,name:"Data transaction validation",version:mode === "initial" ? "1.0.0" : "2.0.0",schemaVersion:mode === "initial" ? 1 : 2,
    main:"main.js",description:mode,permissions:[],requires:{services:{storage:"^2.5.0"}}};
  try {
    const installed = await installPluginFiles(id,[{path:"manifest.json",content:JSON.stringify(manifest)},{path:"main.js",content:source}]);
    return {status:"installed",version:installed.manifest.version};
  } catch (error) {
    return {status:"error",message:error instanceof Error ? error.message : String(error)};
  }
}
export async function pluginDataCommand(action: "seed" | "observe" | "documents" | "inspect" | "stopObservation" | "removeSecret") {
  await isolated();
  const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id && command.id === action);
  if (!command) throw Error("Plugin data command missing");
  return parseProbeToast((await command.run())!.toast!);
}
export async function pluginDataDisk() {
  await isolated();
  const entry = (await listPluginEntries()).find(entry => entry.id === id);
  return {installedVersion:entry ? JSON.parse(entry.manifest).version as string : null, snapshot:await snapshotPluginData(id),contributions:inspectContributions(id).length};
}
export async function cleanupPluginDataProbe() {
  await isolated(); await uninstallPlugin(id);
  const afterUninstall = await pluginDataDisk();
  await deletePluginSecret(id,"probe");
  for (const key of Object.keys(localKV.entries(`read-aware-plugin.${id}.`))) await localKV.removeItemAsync(`read-aware-plugin.${id}.${key}`);
  await localKV.removeItemAsync(PLUGIN_SCHEMA_KEY_PREFIX+id);
  return {afterUninstall,afterCleanup:await pluginDataDisk()};
}
