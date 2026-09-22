import {
  CaretLeft, CaretRight, ChatCircle, ChatCircleDots, Copy, Crosshair, Highlighter, ListBullets, Notebook,
  NotePencil, SpeakerHigh, SpeakerSlash, TextAa, TextUnderline, X,
} from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { useLocale, useTranslation } from "../../../i18n";
import { resolvePluginText, contributionText } from "../../plugins/lib/plugin-i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import type { RegisteredReaderMode, SelectionActionInput } from "../../plugins/lib/plugin-types";
import { runPluginContribution } from "../../plugins/lib/run-result";
import { selectionActionsAtom } from "../../plugins/state/plugin-store";
import type { HoldMenuAction, HoldMenuMoreItem } from "../components/ReaderHoldMenu";
import type { ReaderPanelKind } from "../state/panel-intent";

/**
 * The touch reader's hold menu content in text-unit mode. The first tier is
 * what a reader does to the passage in front of them; navigation, the step
 * unit, plugin lookups and the panels sit one tier behind "more". The same
 * inputs drive the desktop navigator bar, so the two surfaces never drift.
 */
export function useTextUnitHoldActions({ mode, unitId, tapToAdvance, canStep, canReturn, returnPending, canAnnotate,
  askAiEnabled, readAloud, pluginInput, on }: {
  /** Null while no text-unit mode is registered: the menu then has no content. */
  mode: RegisteredReaderMode | null;
  unitId: string;
  tapToAdvance: boolean;
  canStep: boolean;
  canReturn: boolean;
  returnPending: boolean;
  canAnnotate: boolean;
  askAiEnabled: boolean;
  readAloud: { available: boolean; playing: boolean; canStart: boolean; toggle: () => void };
  /** The resting unit as plugin input; null hides plugin lookups. */
  pluginInput: SelectionActionInput | null;
  on: {
    highlight: () => void;
    underline: () => void;
    addNote: () => void;
    askAI: () => void;
    copy: () => void;
    prev: () => void;
    next: () => void;
    returnToCurrent: () => void;
    unitChange: (unitId: string) => void;
    openPanel: (panel: ReaderPanelKind) => void;
    exit: () => void;
  };
}): { title: string; moreLabel: string; actions: HoldMenuAction[]; moreItems: HoldMenuMoreItem[] } {
  const { t } = useTranslation("reader");
  const locale = useLocale();
  const pluginActions = useAtomValue(selectionActionsAtom).filter(action => action.state?.visible !== false);
  if (!mode) return { title: "", moreLabel: "", actions: [], moreItems: [] };
  const activeUnit = resolveReaderModeUnit(mode, unitId);
  const quickUnits = mode.units.filter(unit => unit.id !== mode.defaultUnitId);

  const actions: HoldMenuAction[] = [
    { id: "highlight", label: t("menu.highlight"), icon: <Highlighter size={16} aria-hidden="true" />, run: on.highlight, disabled: !canAnnotate },
    { id: "underline", label: t("menu.underline"), icon: <TextUnderline size={16} aria-hidden="true" />, run: on.underline, disabled: !canAnnotate },
    { id: "note", label: t("menu.addNote"), icon: <NotePencil size={16} aria-hidden="true" />, run: on.addNote, disabled: !canAnnotate },
    ...(askAiEnabled ? [{ id: "askAI", label: t("menu.askAi"), icon: <ChatCircleDots size={16} aria-hidden="true" />, run: on.askAI, disabled: !canAnnotate }] : []),
    { id: "copy", label: t("menu.copy"), icon: <Copy size={16} aria-hidden="true" />, run: on.copy },
    ...(readAloud.available ? [{
      id: "readAloud",
      label: readAloud.playing ? t("readAloud.stop") : t("readAloud.start"),
      icon: readAloud.playing ? <SpeakerSlash size={16} aria-hidden="true" /> : <SpeakerHigh size={16} aria-hidden="true" />,
      run: readAloud.toggle,
      disabled: !readAloud.playing && !readAloud.canStart,
      pressed: readAloud.playing,
    }] : []),
  ];

  const moreItems: HoldMenuMoreItem[] = [
    { label: resolvePluginText(activeUnit.previousLabel, locale), disabled: !canStep, onClick: on.prev, icon: <CaretLeft size={16} /> },
    // A page tap already steps forward on touch; the item returns with the tap disarmed.
    ...(tapToAdvance ? [] : [{ label: resolvePluginText(activeUnit.nextLabel, locale), disabled: !canStep, onClick: on.next, icon: <CaretRight size={16} /> }]),
    { label: resolvePluginText(mode.copy.returnToCurrent, locale), disabled: !canReturn, checked: returnPending || undefined, onClick: on.returnToCurrent, icon: <Crosshair size={14} /> },
    ...quickUnits.map(unit => ({
      label: resolvePluginText(unit.toggleLabel ?? unit.label, locale),
      checked: unit.id === activeUnit.id,
      onClick: () => on.unitChange(unit.id === activeUnit.id ? mode.defaultUnitId : unit.id),
      icon: renderPluginIcon(unit.icon, 14),
    })),
    ...(pluginInput ? pluginActions.map(action => ({
      label: contributionText(action.title),
      disabled: action.state?.enabled === false,
      checked: action.state?.checked,
      icon: renderPluginIcon(action.icon, 14),
      onClick: () => void runPluginContribution(action.pluginId, action.pluginName, () => action.run(pluginInput),
        { presentation: action.presentation, owner: action.run }),
    })) : []),
    { label: t("tableOfContents"), onClick: () => on.openPanel("toc"), icon: <ListBullets size={14} /> },
    { label: t("notes"), onClick: () => on.openPanel("annotations"), icon: <Notebook size={14} /> },
    { label: t("readingAppearance"), onClick: () => on.openPanel("appearance"), icon: <TextAa size={14} /> },
    { label: t("chat"), onClick: () => on.openPanel("chat"), icon: <ChatCircle size={14} /> },
    { label: resolvePluginText(mode.copy.exit, locale), onClick: on.exit, icon: <X size={14} /> },
  ];

  return {
    title: resolvePluginText(mode.copy.title, locale),
    moreLabel: resolvePluginText(mode.copy.moreActions, locale),
    actions,
    moreItems,
  };
}
