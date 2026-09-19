import { MagnifyingGlass } from "@phosphor-icons/react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type SearchFieldProps = {
  /** Accessible name; search fields intentionally have no visible label. */
  label: string;
  size?: "sm" | "md";
  /** Plain fields inherit the surrounding search surface's border and spacing. */
  variant?: "outlined" | "plain";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label" | "size">;

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField({ label, size = "md", variant = "outlined", className, ...props }, ref) {
    return (
      <label
        className={cn(
          "flex items-center gap-2 transition-colors",
          variant === "outlined" && cn(
            "rounded-none border border-border bg-[var(--ra-main-surface-color)] focus-within:border-fg-subtle",
            size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2",
          ),
          variant === "plain" && "rounded-none border-0 bg-transparent p-0",
          className,
        )}
      >
        <MagnifyingGlass
          size={size === "sm" ? 14 : 16}
          className="shrink-0 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          ref={ref}
          type="search"
          aria-label={label}
          className={cn(
            "w-full appearance-none rounded-none bg-transparent font-sans text-fg outline-none placeholder:text-fg-subtle",
            size === "sm" ? "text-sm" : "text-base",
          )}
          {...props}
        />
      </label>
    );
  },
);

SearchField.displayName = "SearchField";
