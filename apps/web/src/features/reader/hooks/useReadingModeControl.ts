import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useLocale } from "../../../i18n";
import { readingRuntime } from "../../../domain/reading-runtime";
import { afterLocalKVWrites, onLocalKVCommit } from "../../../platform/local-store";
import { actorFromEvent, causalActor, eventCause } from "../../../platform/domain-actor";
import { pluginSettingsKey } from "../../plugins/lib/plugin-settings";
import { readerModesAtom, setActiveReaderMode, releaseActiveReaderMode } from "../../plugins/state/plugin-store";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { ReadingModeController } from "../lib/reading-mode-controller";
import { readTextUnitModeState, readTextUnitModeSettings, ReadingModeConfigurationWrites, isTextUnitModeStateCompatible, textUnitModeStateKey } from "../lib/text-unit-mode-state";

/** One mode owner for native controls and both external actors. */
export function useReadingModeControl(bookId: string, supported: boolean) {
  const modes = useAtomValue(readerModesAtom);
  const locale = useLocale();
  const controller = useMemo(() => {
    const saved = readTextUnitModeState(bookId);
    const session = readingRuntime.snapshot();
    const origin = session.bookId === bookId && session.sessionId ? readingRuntime.openingActor(session.sessionId) : "system";
    const controller = new ReadingModeController(saved.active, saved.modeKey ? readTextUnitModeSettings(saved.modeKey).unitId ?? saved.unitId : saved.unitId,
      35_000, saved.modeKey, key => readTextUnitModeSettings(key).unitId, origin);
    controller.requireDurability();
    return controller;
  }, [bookId]);
  const configurationWrites = useMemo(() => new ReadingModeConfigurationWrites(controller.configurationConfirmed), [controller]);
  const request = useSyncExternalStore(controller.observe, controller.requested);
  const snapshot = useSyncExternalStore(controller.observe, controller.snapshot);
  const mode = modes.find(mode => mode.kind === "text-unit-navigator" && mode.key === request.modeKey) ?? null;
  const descriptors = useMemo(() => modes.filter(mode => mode.kind === "text-unit-navigator").map(mode => ({
    key: mode.key, label: `${mode.pluginName}: ${resolvePluginText(mode.copy.title, locale)}`, defaultUnitId: mode.defaultUnitId,
    units: mode.units.map(unit => ({ id: unit.id, label: resolvePluginText(unit.label, locale) })),
    implementation: mode.segmentText,
  })), [modes, locale]);
  const persistRequest = useCallback(() => {
    const requested = controller.requested();
    controller.trackConfiguration(requested.revision, afterLocalKVWrites(() => {
      if (controller.requested() !== requested) return;
      const { modeKey: key, unitId } = requested;
      const saved = readTextUnitModeState(bookId);
      return configurationWrites.write(requested.revision, bookId, {
        ...saved, active: requested.active, modeKey: key, unitId,
        resting: requested.active && key && unitId && isTextUnitModeStateCompatible(saved, key, unitId, saved.contentVersion) ? saved.resting : null,
      }, controller.snapshot().units.some(unit => unit.id === unitId), requested.origin);
    }));
  }, [bookId, controller, configurationWrites]);
  const retire = useCallback(() => {
    // The navigator/subscription may already be unmounting. Retain cancellation.
    if (controller.retire()) persistRequest();
  }, [controller, persistRequest]);
  useEffect(() => {
    controller.environment(descriptors, supported, controller.generation() === 0 ? controller.requested().origin : "system");
  }, [controller, descriptors, supported]);
  useEffect(() => {
    const publish = () => setActiveReaderMode(controller, controller.requested().modeKey);
    publish();
    const off = controller.observe(publish);
    return () => { off(); releaseActiveReaderMode(controller); };
  }, [controller]);

  useEffect(() => onLocalKVCommit(commit => {
    const key = controller.requested().modeKey;
    if (!key || commit.entries.some(entry => entry.key === textUnitModeStateKey(bookId))) return;
    // Configuration already commits the book and provider together. Only a
    // separate durable preference edit is a new intent; optimistic mirrors
    // and failed-write rollback must never manufacture one.
    const entry = commit.entries.find(entry => entry.key === pluginSettingsKey(key.slice(0, key.indexOf(":"))));
    if (!entry) return;
    let unitId: string | null = null;
    try {
      const value: unknown = entry.value ? JSON.parse(entry.value) : null;
      if (value && typeof value === "object" && "unitId" in value && typeof value.unitId === "string") unitId = value.unitId;
    } catch { /* Invalid stored values provide no unit preference. */ }
    const origin = eventCause(commit) ? actorFromEvent(commit, commit.actor ?? "system") : causalActor("system");
    void controller.reconcilePreference(() => unitId, origin);
  }), [bookId, controller]);
  useEffect(() => {
    let persisted: ReturnType<ReadingModeController["requested"]> | undefined;
    const persist = () => {
      const requested = controller.requested();
      if (requested === persisted) return;
      persisted = requested;
      persistRequest();
    };
    // Persist the current request, never the request captured by an older render.
    persist();
    return controller.observe(persist);
  }, [controller, persistRequest]);

  useEffect(() => {
    let sessionId: string | null = null;
    let release: (() => void) | undefined;
    const unobserve = readingRuntime.observe(state => {
      const id = state.bookId === bookId && state.status === "ready" ? state.sessionId : null;
      if (id === sessionId) return;
      sessionId = id;
      release?.(); release = undefined;
      if (id) release = readingRuntime.bindMode(id, { snapshot: controller.snapshot, observe: controller.observe, generation: controller.generation,
        waitForPosition: (position, signal) => controller.waitForPosition(position, signal),
        step: (direction, signal, origin) => controller.step(direction, signal, origin),
        configure: (input, signal, origin) => controller.configure(input, signal, origin), retire });
    });
    return () => { unobserve(); release?.(); retire(); void afterLocalKVWrites(() => configurationWrites.release()); };
  }, [bookId, controller, retire, configurationWrites]);

  const setActive = useCallback((active: boolean) => controller.choose(active), [controller]);
  const setUnit = useCallback((unitId: string) => controller.choose(controller.requested().active, unitId), [controller]);
  return { controller, request, snapshot, mode, setActive, setUnit };
}
