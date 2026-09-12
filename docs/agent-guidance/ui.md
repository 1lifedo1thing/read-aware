# UI conventions

Read when changing product UI, shared components, or Storybook stories.
Paths below are relative to the repository root.

## Design System

The component library is its own package, `@read-aware/ui` (`packages/ui/`), with co-located Storybook stories. Run `bun run storybook` to browse (Storybook is hosted by `apps/web` and scans both `packages/ui` and feature stories).

### Design Tokens

Defined in `apps/web/src/index.css` via `@theme` block:
- Colors: `paper`, `paper-warm`, `border` (plus Tailwind's built-in `stone-*` palette)
- Fonts: `sans` (Inter), `serif`, `mono`
- Sizes: `text-eyebrow` (11px), `text-caption` (12px)
- Leading: `leading-display` (0.98), `leading-body` (2rem)

### Component Library

Always use these components instead of raw HTML + Tailwind classes:

**Typography:** `Display`, `Heading`, `Body`, `Eyebrow`, `Caption`
**Form controls:** `TextField`, `SearchField`, `TextArea`, `Select`, `Checkbox`, `Radio`, `Toggle`, `ChoiceGroup`
**Buttons:** `Button` (solid/outline/ghost/link/danger), `IconButton`
**Navigation:** `NavItem`, `Breadcrumb`, `Tabs`
**Data display:** `Avatar`, `Badge`, `Tag`, `Kbd`, `DefinitionList`, `Metadata`, `Metric`, `Progress`, `Quote`, `ItemList`, `Skeleton`, `Spinner`
**Layout:** `Stack`, `Columns`, `Section`, `Detail`, `Divider`, `Card` (compound: Header/Body/Footer)
**Feedback:** `Alert`, `EmptyState`, `Tooltip`
**Overlays:** `Dialog`, `Sidebar`, `DropdownMenu`, `Popover`, `Accordion`

Import from the package barrel: `import { Button, Card, Display } from "@read-aware/ui";`

### Utility

Use `cn()` from `@read-aware/ui/cn` for className composition (clsx + tailwind-merge). The `useLocalAtom` hook is available from `@read-aware/ui/state`.

### Design Principles

- Editorial restraint: no gradients, no badges, no ornamental highlights
- Paper-toned canvas, monochrome stone palette, warm and quiet
- Typography carries hierarchy; the interface stays visually spare
- Serif for display, sans for everything else
- `stone-600` minimum for text on paper backgrounds (WCAG AA)

### Iconography Rule

- Use `@phosphor-icons/react` for all product UI icons
- Do not hand-draw inline SVG icons in feature or app code
- Keep icons functional and quiet (avoid decorative icon usage)

## Conventions

- Components use `forwardRef` for form controls, plain functions for everything else
- Polymorphic components use `as` prop with `ElementType` + `ComponentPropsWithRef`
- All interactive components must be keyboard-navigable with proper ARIA
- Stories co-located next to components: `Component.stories.tsx`
- Storybook hierarchy: `Design System/Components/...`, `Design System/Guidelines/...`, `Interface/...`

### Responsibility Boundaries

- Every file must have one clear responsibility. Do not let rendering, state orchestration, DOM measurement, async data flows, and pure data transforms accumulate in the same file.
- Components should focus on UI structure and prop composition. If a component starts owning non-trivial effects, async workflows, or cross-feature coordination, extract that logic into a hook.
- Hooks should own stateful client logic, browser APIs, subscriptions, measurements, and async orchestration. If the logic does not need React, it should not live in a hook.
- `lib/` and `utils/` modules should stay pure and reusable. Put formatting, derived data, mappers, and domain helpers there instead of inside components.
- Before adding new code to an existing file, first decide whether it belongs in a component, a hook, or a util. Prefer extraction over growing a mixed-responsibility file.
