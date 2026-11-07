# UI components

Before adding or retaining a custom component, ask whether Chakra UI already supplies its interaction, accessibility and
styling.

Use Chakra primitives directly for generic controls. Use SegmentGroup for theme selection, Switch for booleans, Field
with Input or Textarea for entry, Select with a collection for choices, Button for actions, Alert for persistent errors,
Toaster for notifications and ActionBar for contextual batch actions. Put shared styling in app/theme.ts using tokens,
semantic tokens, recipes and slot recipes.

Custom components should compose these primitives and own application behavior. Current reasons for keeping application
components include:

- Editors, resource pickers and translation forms coordinate file formats, validation and persistence.
- Archive and policy trees compose Chakra TreeView and handle large file indexes and virtualization.
- TextEditor embeds CodeMirror for syntax editing. Chakra has no code editor.
- GameText, game fonts, inventory icons and media canvases reproduce Perfect World resources.
- EditorSwitch composes Chakra Switch with the existing boolean field API.
- select-collection converts conditional game-data choices and numeric IDs into Chakra collections. It introduces no
  custom select control.
- Loading and notification compositions share Chakra Skeleton, Progress and Toaster setup.

Revisit this reason when editing a component. Reuse Chakra behavior instead of implementing another focus, selection,
popup, notification or theme system.

Prefer the supplied components/ui snippets for compound Chakra compositions. Keep handlers outside JSX when they contain
validation, asynchronous work or several operations. Name callbacks for the user action. Split screens into UI sections,
resource documents and state hooks instead of accumulating unrelated behavior in the main app component.

Keep literal interface colors in app/theme.ts. CSS and JSX should reference semantic tokens. Preview overlays also use
tokens, while colors read from game files remain game data.

Interface source strings are English. Use t ("English text") for labels and named placeholders for values. Keep both
catalogs in i18n/locales/en.json and i18n/locales/ru.json synchronized. Keep UI language separate from translation
target locales and game-file contents. Use sourceText only for metadata from older backend commands, and message for
command errors or stored status messages.
