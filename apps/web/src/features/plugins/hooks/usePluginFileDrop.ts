import { useLayoutEffect, useRef, type DragEvent } from "react";
import { AppError } from "@read-aware/core";
import type { PluginView } from "../lib/plugin-types";
import type { PluginResultRunner } from "../components/plugin-view-types";
import { deliverPluginFiles, pickPluginFiles, pluginFileDropOwner } from "../lib/plugin-file-drop";
import { dragCarriesBooks } from "../../shelf/lib/book-drag";

export function usePluginFileDrop(drop: NonNullable<PluginView["fileDrop"]>, busy: boolean, visible: boolean, onResult: PluginResultRunner) {
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    if (!visible) controller.abort();
    return () => { controller.abort(); if (lifetime.current === controller) lifetime.current = null; };
  }, [drop, visible]);
  const files = (event: DragEvent) => !dragCarriesBooks(event.dataTransfer) && event.dataTransfer.types.includes("Files");
  return {
    owner: pluginFileDropOwner(drop),
    onDragOver(event: DragEvent) {
      if (!files(event)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy";
    },
    onDrop(event: DragEvent) {
      if (!files(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.nativeEvent.isTrusted || busy || !lifetime.current || lifetime.current.signal.aborted) return;
      const selected = Array.from(event.dataTransfer.files), signal = lifetime.current.signal;
      if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        void onResult(() => { throw new AppError("ui/invalid-target", "Drop files, or use the directory chooser for folders"); }); return;
      }
      void onResult(() => deliverPluginFiles(drop, selected, signal));
    },
    choose() {
      const signal = lifetime.current?.signal;
      if (!busy && visible && signal && !signal.aborted) void onResult(() => pickPluginFiles(drop, signal));
    },
  };
}
