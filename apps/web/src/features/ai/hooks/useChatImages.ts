import { useEffect, useRef, useState } from "react";
import { AppError, MODEL_IMAGES_MAX_COUNT } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { storeChatImage } from "../lib/chat-image";
import type { ChatImageAttachment } from "../lib/chat-types";

const log = createLogger("chat-images");
export function useChatImages() {
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  const { toast } = useToast();
  useEffect(() => () => active.current?.abort(), []);
  async function add(files: File[]) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setLoading(true);
    try {
      if (images.length + files.length > MODEL_IMAGES_MAX_COUNT) throw new AppError("ai/image-budget-exceeded", "At most four images per message");
      const prepared: ChatImageAttachment[] = [];
      for (const file of files) prepared.push(await storeChatImage(file, controller.signal));
      if (!controller.signal.aborted) setImages(current => [...current, ...prepared]);
    } catch (error) {
      if (!controller.signal.aborted) { log.warn("Image attachment failed", error); toast({ variant: "destructive", description: describeError(error).body }); }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return { images, loading, add, remove: (index: number) => setImages(images => images.filter((_, i) => i !== index)), clear: () => setImages([]) };
}
