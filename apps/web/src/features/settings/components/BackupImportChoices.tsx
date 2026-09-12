import { Body, Button, Caption, ChoiceGroup, Select, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { BackupImportFlow } from "./BackupImportDialog";
import type { BackupReviewView } from "./BackupImportReview";
import type { BackupCredentialChoice } from "../lib/full-backup-apply";
import type { BackupProgramChoice } from "../../plugins/runtime/backup-program-review";

export function BackupImportChoices({ flow, view }: { flow: BackupImportFlow; view: BackupReviewView }) {
  const { t } = useTranslation("settings"), model = view.model;
  const sides = [{ value: "source", label: t("dataSync.importDialog.source") }, { value: "target", label: t("dataSync.importDialog.target") }];
  const programChoice = (id: string, patch: Partial<BackupProgramChoice>) => {
    const fact = model.programs.find(item => item.id === id)!;
    const current = fact.builtin ? fact.candidates.find(candidate => candidate.side === "target") : null;
    const fallback = current ? { side: current.side, root: current.root, sha256: current.sha256 } : null;
    flow.editChoices({ programChoices: { ...model.programChoices, [id]: { ...(model.programChoices[id] ?? { program: fallback, data: "target" }), ...patch } } });
  };
  return <>
    {(["files", "programs", "credentials"] as const).map(kind => <details key={kind}>
      <summary className="cursor-pointer text-sm">{t(`dataSync.importDialog.${kind}`)} ({model[kind].length})</summary>
      <Stack gap="md" className="pt-3">
        {kind === "files" && model.files.slice(view.catalogPages.files * 20, (view.catalogPages.files + 1) * 20).map(file => <Stack key={file.path} gap="sm" className="border-b border-border pb-3">
          <Caption className="break-all">{file.targetBlob?.key ?? file.path}</Caption><Caption>{t(`dataSync.importDialog.kinds.${file.kind}`)} · {file.source?.byteSize} bytes</Caption>
          <ChoiceGroup label={t("dataSync.importDialog.valueSource")} value={model.fileChoices[file.path] ?? ""} options={sides} disabled={view.busy}
            onChange={side => flow.editChoices({ fileChoices: { ...model.fileChoices, [file.path]: side as "source" | "target" } })} />
        </Stack>)}
        {kind === "programs" && <><Body>{t("dataSync.importDialog.programNotice")}</Body>
          {model.programs.slice(view.catalogPages.programs * 20, (view.catalogPages.programs + 1) * 20).map(program => {
            const chosen = model.programChoices[program.id];
            const selectedIndex = chosen?.program ? program.candidates.findIndex(candidate => candidate.side === chosen.program!.side && candidate.sha256 === chosen.program!.sha256 && candidate.root === chosen.program!.root) : -1;
            return <Stack key={program.id} gap="sm" className="border-b border-border pb-3"><Caption>{program.id}</Caption>
              <Select label={t("dataSync.importDialog.programCode")} value={!chosen ? "" : selectedIndex < 0 ? "none" : String(selectedIndex)} disabled={view.busy}
                options={[...(!program.builtin ? [{ value: "none", label: t("dataSync.importDialog.dataOnly") }] : []),
                  ...program.candidates.flatMap((candidate, index) => program.builtin && candidate.side !== "target" ? [] : [{ value: String(index), label: `${t(`dataSync.importDialog.${candidate.side}`)} · ${candidate.root}` }])]}
                onChange={value => { const candidate = value === "none" ? null : program.candidates[Number(value)]!;
                  programChoice(program.id, { program: candidate ? { side: candidate.side, root: candidate.root, sha256: candidate.sha256 } : null }); }} />
              <ChoiceGroup label={t("dataSync.importDialog.programData")} value={chosen?.data ?? ""} options={sides} disabled={view.busy}
                onChange={data => programChoice(program.id, { data: data as "source" | "target" })} />
              <Caption>{t("dataSync.importDialog.programVersions", { source: program.sourceData.schema ?? "—", target: program.targetData.schema ?? "—" })}</Caption>
            </Stack>;
          })}</>}
        {kind === "credentials" && <><Body>{t("dataSync.importDialog.credentialNotice")}</Body>
          {model.credentials.slice(view.catalogPages.credentials * 20, (view.catalogPages.credentials + 1) * 20).map(fact => <Stack key={fact.slot} gap="sm" className="border-b border-border pb-3">
            <Caption className="break-all">{fact.slot}</Caption>
            <Select label={t("dataSync.importDialog.valueSource")} value={model.credentialChoices[fact.slot] ?? ""} disabled={view.busy}
              options={(["sourceLocal", "targetLocal", "sourceRoaming", "targetRoaming"] as const).flatMap(choice => {
                const state = choice === "sourceLocal" ? fact.sourceLocal ? "value" : "absent" : choice === "targetLocal" ? fact.targetLocal ? "value" : "absent"
                  : choice === "sourceRoaming" ? fact.sourceRoaming : fact.targetRoaming;
                return state === "locked" ? [] : [{ value: choice, label: `${t(`dataSync.importDialog.credentialsFrom.${choice}`)} · ${t(`dataSync.importDialog.credentialStates.${state}`)}` }];
              })} onChange={choice => flow.editChoices({ credentialChoices: { ...model.credentialChoices, [fact.slot]: choice as BackupCredentialChoice } })} />
          </Stack>)}</>}
        {model[kind].length > 20 && <Stack direction="horizontal" gap="sm"><Button variant="ghost" disabled={view.busy || view.catalogPages[kind] === 0}
          onClick={() => flow.catalogPage(kind, view.catalogPages[kind] - 1)}>{t("dataSync.importDialog.previousPage")}</Button>
          <Caption>{view.catalogPages[kind] + 1} / {Math.ceil(model[kind].length / 20)}</Caption>
          <Button variant="ghost" disabled={view.busy || (view.catalogPages[kind] + 1) * 20 >= model[kind].length}
            onClick={() => flow.catalogPage(kind, view.catalogPages[kind] + 1)}>{t("dataSync.importDialog.nextPage")}</Button></Stack>}
      </Stack>
    </details>)}
  </>;
}
