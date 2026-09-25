import { Check } from "@phosphor-icons/react";
import { ItemList, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { FontChoiceStatus } from "./FontField";

type FontListProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a list: every choice on its own line, the current one
 * checked, for a page of its own where a dropdown would be one more layer
 * (the phone's appearance drawer). The same choices as FontField — curated
 * and plugin fonts, or with "Custom" on, the fonts installed on this device
 * (see useFontChoices).
 */
export function FontList({ className, ...options }: FontListProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  return (
    <div className={className}>
      <ItemList>
        <ItemList.Item
          title={t("font.custom")}
          subtitle={t("font.customAria")}
          disclosure="none"
          accessories={<Toggle aria-label={t("font.customAria")} checked={fonts.custom} onChange={fonts.setCustom} />}
        />
        {fonts.options.map((option) => {
          const selected = option.value === fonts.selectValue;
          return (
            <ItemList.Item
              key={option.value}
              title={option.label}
              disclosure="none"
              selected={selected}
              onClick={() => fonts.choose(option.value)}
              accessories={selected ? <Check size={16} weight="bold" aria-hidden="true" className="text-fg" /> : null}
            />
          );
        })}
      </ItemList>
      <div className="px-2">
        <FontChoiceStatus fonts={fonts} />
      </div>
    </div>
  );
}
