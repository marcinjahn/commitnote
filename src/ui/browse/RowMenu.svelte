<script lang="ts">
  import { actionIcons } from "./action-icons";
  import type { ColorTag } from "../../tags/color-tag";
  import MenuPopup from "./MenuPopup.svelte";
  import type { MenuAnchor, MenuItem, RowAction } from "./row-menu-types";

  interface Props {
    name: string;
    kind: "note" | "folder";
    hasFolders: boolean;
    trashes: boolean;
    anchor: MenuAnchor;
    colorTag: ColorTag | null;
    tagsWritable: boolean;
    onColorTag: (color: ColorTag | null) => void;
    onAction: (action: RowAction) => void;
    onClose: () => void;
    trigger: HTMLElement;
  }

  const {
    name,
    kind,
    hasFolders,
    trashes,
    anchor,
    colorTag,
    tagsWritable,
    onColorTag,
    onAction,
    onClose,
    trigger,
  }: Props = $props();

  function item(id: RowAction, label: string): MenuItem<RowAction> {
    return { id, label, icon: actionIcons[id] };
  }

  const deleteLabel = $derived(trashes ? "Move to trash…" : "Delete…");

  const allItems: readonly MenuItem<RowAction>[] = $derived(
    kind === "folder"
      ? [
          item("new-note", "New note…"),
          item("new-folder", "New folder…"),
          item("rename", "Rename…"),
          item("move", "Move to folder…"),
          item("delete", deleteLabel),
        ]
      : [item("move", "Move to folder…"), item("delete", deleteLabel)],
  );

  const items = $derived(
    hasFolders ? allItems : allItems.filter((entry) => entry.id !== "move"),
  );
</script>

<MenuPopup
  label={`Actions for ${name}`}
  {items}
  swatches={kind === "note"
    ? { selected: colorTag, disabled: !tagsWritable, onPick: onColorTag }
    : undefined}
  {anchor}
  {trigger}
  onSelect={onAction}
  {onClose}
/>
