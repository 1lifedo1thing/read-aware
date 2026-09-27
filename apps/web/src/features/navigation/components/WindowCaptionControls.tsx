/**
 * Self-drawn window caption controls — minimize / maximize-restore / close —
 * for the frameless Windows and Linux shells, sitting flush against the
 * header's top-right corner (mirroring the macOS traffic lights on the left).
 * Renders nothing when the platform draws its own chrome (macOS, browser,
 * mobile). Layout reserves their width via --ra-window-controls-inset.
 *
 * On macOS a dev preview is available: `localStorage.setItem("ra-debug-os",
 * "windows")` + reload forces this chrome (and hides the real traffic lights
 * while mounted) so the layout can be exercised without a Windows machine.
 */
import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  desktopChromeKind,
  isMacOS,
  isWindows,
  type DesktopChromeKind,
} from "../../../platform/environment";
import { setTrafficLightsVisible } from "../../../platform/traffic-lights";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import { invoke } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { useWindowActions } from "../hooks/useWindowActions";

const log = createLogger("window-caption");

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

type WindowCaptionControlsProps = {
  /**
   * Which chrome the shell draws. Defaults to the running platform's; the
   * header passes its own resolved value so the decision is read once rather
   * than in both places (and so a story can render another platform's bar).
   */
  chrome?: DesktopChromeKind;
};

export function WindowCaptionControls({
  chrome = desktopChromeKind(),
}: WindowCaptionControlsProps = {}) {
  const { t } = useTranslation("nav");
  const custom = chrome === "custom";
  const maximized = useWindowMaximized(custom);
  const windowAction = useWindowActions();

  // Dev preview on a real Mac: the native traffic lights would double up with
  // these controls — hide them for the preview's lifetime.
  useEffect(() => {
    if (!custom || !isMacOS()) return;
    void setTrafficLightsVisible(false);
    return () => {
      void setTrafficLightsVisible(true);
    };
  }, [custom]);

  if (!custom) return null;

  // Windows 11 Snap Layouts open from hovering the native maximize button;
  // decorum's command replays that for a self-drawn one. Elsewhere it no-ops.
  const showSnapOverlay = () => {
    if (!isWindows()) return;
    void invoke("plugin:decorum|show_snap_overlay").catch((error) => {
      // Hover-only enhancement: log failures without interrupting window controls.
      log.warn("Could not show Windows Snap Layouts", error);
    });
  };

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex items-stretch">
      <IconButton
        size="caption"
        label={t("window.minimize")}
        onClick={() => windowAction({ action: "minimize" })}
        icon={<Minus size={14} weight="regular" aria-hidden="true" />}
      />
      <IconButton
        size="caption"
        label={maximized ? t("window.restore") : t("window.maximize")}
        onMouseEnter={showSnapOverlay}
        onClick={() => windowAction({ action: maximized ? "restore" : "maximize" })}
        icon={maximized
          ? <CopySimple size={14} weight="regular" aria-hidden="true" />
          : <Square size={13} weight="regular" aria-hidden="true" />}
      />
      <IconButton
        size="caption"
        tone="close"
        label={t("window.close")}
        onClick={() => void currentWindow().then((w) => w.close())}
        icon={<X size={15} weight="regular" aria-hidden="true" />}
      />
    </div>
  );
}
