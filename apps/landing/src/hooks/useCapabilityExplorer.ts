import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  normalizeSearchText,
  validateExplorerSearch,
  type CapabilityEntry,
  type CapabilityKey,
  type ExplorerSearch,
} from "../lib/plugin-capabilities";

export function useCapabilityExplorer() {
  const location = useRouterState({ select: (state) => state.location });
  const navigate = useNavigate();
  const search = validateExplorerSearch(location.search);
  function update(patch: ExplorerSearch, replace = true) {
    void navigate({
      to: location.pathname as never,
      search: { ...search, ...patch } as never,
      replace,
      resetScroll: false,
    });
  }
  function reset() {
    void navigate({
      to: location.pathname as never,
      search: {} as never,
      replace: true,
      resetScroll: false,
    });
  }
  return { search, update, reset, pathname: location.pathname };
}

export function useExplorerSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        inputRef.current &&
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target?.closest("input,textarea,select,[contenteditable=true]")
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return inputRef;
}

// Keep an edited manifest while the developer switches back to the capability catalog.
export function useManifestDraft(sample: string) {
  return useState(sample);
}

export function useCapabilityDetail(
  entry: CapabilityEntry,
  initialQuery: string,
) {
  // A method query follows the developer into the detail; a general task query does not hide the API.
  const [methodQuery, setMethodQuery] = useState(() =>
    entry.methods.some((method) =>
      normalizeSearchText(method.path).includes(
        normalizeSearchText(initialQuery),
      ),
    )
      ? initialQuery
      : "",
  );
  const [access, setAccess] = useState<"read" | "write">("read");
  const [section, setSection] = useState<"methods" | "configuration">(
    "methods",
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const terms = normalizeSearchText(methodQuery).split(/\s+/).filter(Boolean);
  const methods = entry.methods.filter((method) =>
    terms.every((term) => normalizeSearchText(method.path).includes(term)),
  );
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current
      ?.closest(".capability-detail")
      ?.scrollIntoView({ block: "start" });
  }, []);
  return {
    methodQuery,
    setMethodQuery,
    methods,
    access,
    setAccess,
    headingRef,
    section,
    setSection,
  };
}

export function useCapabilityLink(key?: CapabilityKey) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copyLink() {
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("cap", key);
    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus("copied");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("failed");
    }
  }
  return { copyLink, status };
}

export function useExplorerReturnFocus(cap?: CapabilityKey) {
  const previous = useRef(cap);
  useEffect(() => {
    if (!cap && previous.current) {
      const card = document.querySelector<HTMLAnchorElement>(
        `[data-capability="${previous.current}"]`,
      );
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest" });
    }
    previous.current = cap;
  }, [cap]);
}
