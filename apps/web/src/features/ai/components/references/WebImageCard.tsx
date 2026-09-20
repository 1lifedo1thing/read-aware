import { Caption, InlineError, Skeleton } from "@read-aware/ui";
import { useTranslation } from "../../../../i18n";
import { useExternalLink } from "../../../../hooks/useExternalLink";
import { useWebImage } from "../../hooks/useWebImage";
import type { ChatWebImageReference } from "../../lib/chat-types";

/** One source-backed illustration in the existing persisted reference timeline. */
export function WebImageCard({ image }: { image: ChatWebImageReference }) {
  const { t } = useTranslation("ai");
  const openExternalLink = useExternalLink();
  const preview = useWebImage(image.url);
  return <figure className="m-0 flex w-60 max-w-full flex-col gap-1.5" data-testid="chat-web-image">
    {preview.failed ? <InlineError compact>{t("chat.references.imageUnavailable")}</InlineError>
      : preview.url ? <img src={preview.url} alt={image.caption} onError={preview.failedImage}
        className="max-h-72 w-full rounded-sm object-contain object-left" />
      : <Skeleton className="h-56 w-full rounded-sm" aria-label={t("chat.references.imageLoading")} />}
    <figcaption className="flex flex-col gap-0.5">
      <Caption>{image.caption}</Caption>
      <a href={image.sourceUrl} onClick={openExternalLink} target="_blank" rel="noreferrer"
        className="text-caption text-fg-muted underline underline-offset-4">{t("chat.references.imageSource", { source: image.title })}</a>
    </figcaption>
  </figure>;
}
