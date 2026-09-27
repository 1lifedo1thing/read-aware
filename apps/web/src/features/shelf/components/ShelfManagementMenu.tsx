import { useState, type ReactNode } from "react";
import { Rows, SlidersHorizontal, SquaresFour } from "@phosphor-icons/react";
import { Button, ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import { useAtom } from "jotai";
import { useTranslation } from "../../../i18n";
import { shelfViewAtom } from "../../../state/ui";
import type { ShelfGroup, ShelfLayout, ShelfSort } from "../lib/shelf-view";
import { useShelfSelection } from "../hooks/useShelfSelection";

const LAYOUT_ICONS: { value: ShelfLayout; icon: ReactNode }[] = [
  { value: "grid", icon: <SquaresFour size={15} weight="regular" /> },
  { value: "list", icon: <Rows size={15} weight="regular" /> },
];

const GROUP_VALUES: ShelfGroup[] = ["none", "status", "author", "format"];
const SORT_VALUES: ShelfSort[] = ["recent", "added", "title", "author", "progress"];

const groupEyebrow = "mb-1.5 font-sans text-[13px] font-medium text-fg-muted";

/**
 * The shelf's management menu — layout, grouping, and sort controls today, and
 * the home for further shelf-wide management (e.g. batch actions) as it grows.
 * Starring is per-book and lives on the cards/rows, not here.
 */
export function ShelfManagementMenu() {
  const { t } = useTranslation("shelf");
  const [view, setView] = useAtom(shelfViewAtom);
  const { enter } = useShelfSelection();
  const [open, setOpen] = useState(false);

  const layoutOptions = LAYOUT_ICONS.map((option) => ({
    ...option,
    label: t(`layout.${option.value}`),
  }));
  const groupOptions = GROUP_VALUES.map((value) => ({ value, label: t(`group.${value}`) }));
  const sortOptions = SORT_VALUES.map((value) => ({ value, label: t(`sort.${value}`) }));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={t("manage.trigger")}
      triggerTooltip={t("manage.trigger")}
      triggerClassName="h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      trigger={<SlidersHorizontal size={16} weight="regular" aria-hidden="true" />}
    >
      <div className="w-56">
        <ChoiceGroup
          label={t("manage.layout")}
          value={view.layout}
          options={layoutOptions}
          onChange={(layout) => setView({ ...view, layout })}
        />
        <Divider className="-mx-4 my-3" />
        <ChoiceGroup
          layout="list"
          label={t("manage.groupBy")}
          value={view.group}
          options={groupOptions}
          onChange={(group) => setView({ ...view, group })}
        />
        <Divider className="-mx-4 my-3" />
        <ChoiceGroup
          layout="list"
          label={t("manage.sortBy")}
          value={view.sort}
          options={sortOptions}
          onChange={(sort) => setView({ ...view, sort })}
        />
        <Divider className="-mx-4 my-3" />
        <div>
          <p className={groupEyebrow}>{t("manage.management")}</p>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              enter();
              setOpen(false);
            }}
          >
            {t("manage.selectBooks")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
