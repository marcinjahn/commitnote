export const TAB_TITLE = "commitnote";

const UNSAVED_TAB_TITLE = `● ${TAB_TITLE}`;

export function computeTabTitle(input: { unsaved: boolean; override: string | null }): string {
  if (input.override !== null) return input.override;
  return input.unsaved ? UNSAVED_TAB_TITLE : TAB_TITLE;
}

export interface TabTitle {
  setUnsaved(unsaved: boolean): void;
  override(title: string): () => void;
}

export function createTabTitle(target: { title: string }): TabTitle {
  let unsaved = false;
  let override: { title: string } | null = null;

  const apply = (): void => {
    target.title = computeTabTitle({ unsaved, override: override?.title ?? null });
  };

  return {
    setUnsaved(next) {
      unsaved = next;
      apply();
    },
    override(title) {
      const mine = { title };
      override = mine;
      apply();
      return () => {
        if (override !== mine) return;
        override = null;
        apply();
      };
    },
  };
}

let instance: TabTitle | null = null;

function real(): TabTitle {
  instance ??= createTabTitle(document);
  return instance;
}

export const tabTitle: TabTitle = {
  setUnsaved: (unsaved) => real().setUnsaved(unsaved),
  override: (title) => real().override(title),
};
