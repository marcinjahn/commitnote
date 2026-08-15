// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMarkdownEditor } from "./create-markdown-editor";
import { livePreview } from "./live-preview";

// jsdom only fires a checkbox's native "change" event when it is connected
// to the document, so the editor's parent is attached to the body here.
describe("livePreview task checkbox", () => {
  it("toggles the task marker when the rendered checkbox is clicked, and back", () => {
    const changes: string[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const editor = createMarkdownEditor({
      parent,
      text: "- [ ] task",
      readOnly: false,
      onChange: (text) => changes.push(text),
      extensions: [livePreview()],
    });

    const firstCheckbox = parent.querySelector<HTMLInputElement>(
      ".cm-task-checkbox input",
    );
    expect(firstCheckbox).not.toBeNull();
    firstCheckbox?.click();
    expect(editor.view.state.doc.toString()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);

    // Toggling replaces the checkbox's widget (checked state changed), so the
    // rendered element must be re-queried before clicking it again.
    parent.querySelector<HTMLInputElement>(".cm-task-checkbox input")?.click();
    expect(editor.view.state.doc.toString()).toBe("- [ ] task");
    expect(changes).toEqual(["- [x] task", "- [ ] task"]);

    editor.destroy();
    parent.remove();
  });

  it("does nothing when the editor is read-only", () => {
    const changes: string[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const editor = createMarkdownEditor({
      parent,
      text: "- [ ] task",
      readOnly: true,
      onChange: (text) => changes.push(text),
      extensions: [livePreview()],
    });

    const checkbox = parent.querySelector<HTMLInputElement>(
      ".cm-task-checkbox input",
    );
    expect(checkbox).not.toBeNull();

    checkbox?.click();

    expect(editor.view.state.doc.toString()).toBe("- [ ] task");
    expect(changes).toEqual([]);

    editor.destroy();
    parent.remove();
  });
});
