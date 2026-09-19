import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@read-aware/ui";
import { describeError, describeErrorCode, useTranslation } from "../../../i18n";
import { readLocalApiStatus, setLocalApiEnabled, readLocalApiToken, rotateLocalApiToken,
  supportsLocalApi, type LocalApiStatus } from "../../../platform/local-api";
import { createLogger } from "../../../platform/logger";
import { hostIO } from "../../../services/host-io";
import skill from "../../../assets/skills/readaware/SKILL.md?raw";

const log = createLogger("local-api-settings");
export function useLocalApi() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const supported = supportsLocalApi();
  const [status, setStatus] = useState<LocalApiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const accept = useCallback((next: LocalApiStatus) => {
    if (!mounted.current) return;
    setStatus(next);
    setError(next.errorCode ? describeErrorCode(next.errorCode)?.body ?? null : null);
  }, []);
  const refresh = useCallback(async () => {
    try { accept(await readLocalApiStatus()); }
    catch (error) { log.error("Status read failed", error); if (mounted.current) setError(describeError(error).body); }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    if (supported) void refresh();
    return () => { mounted.current = false; };
  }, [refresh, supported]);
  const run = async (work: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true);
    try { await work(); }
    catch (error) {
      log.error("Action failed", error);
      if (mounted.current) toast({ variant: "destructive", description: describeError(error).body });
      await refresh();
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  };
  return {
    supported, status, error, busy, refresh,
    change: (enabled: boolean) => run(async () => { accept(await setLocalApiEnabled(enabled)); }),
    retry: () => run(async () => { accept(await setLocalApiEnabled(true)); }),
    rotate: () => run(async () => {
      accept(await rotateLocalApiToken());
      toast({ description: t("localApi.rotated") });
    }),
    copyConnection: () => run(async () => {
      const token = await readLocalApiToken();
      await hostIO.writeClipboard(`export READAWARE_API_URL='${status!.baseUrl}'\nexport READAWARE_API_TOKEN='${token}'`);
      toast({ description: t("localApi.copied") });
    }),
    saveSkill: () => run(async () => {
      await hostIO.exportFile({ filename: "SKILL.md", content: skill, mimeType: "text/markdown" });
    }),
    copySkill: () => run(async () => {
      await hostIO.writeClipboard(skill);
      toast({ description: t("localApi.skillCopied") });
    }),
  };
}
