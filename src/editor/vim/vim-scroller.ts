import type { getCM } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";

type VimAdapter = NonNullable<ReturnType<typeof getCM>>;

export function verticalScroller(view: EditorView): HTMLElement {
  const own = view.scrollDOM;
  if (own.scrollHeight > own.clientHeight + 1) return own;
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return own;
}

function contentOffset(view: EditorView, scroller: HTMLElement): number {
  return (
    view.contentDOM.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    scroller.clientTop
  );
}

export function useNoteScroller(cm: VimAdapter, view: EditorView): void {
  cm.getScrollInfo = () => {
    const scroller = verticalScroller(view);
    const own = view.scrollDOM;
    return {
      left: own.scrollLeft,
      top: scroller.scrollTop - contentOffset(view, scroller),
      height: scroller.scrollHeight,
      width: own.scrollWidth,
      clientHeight: scroller.clientHeight,
      clientWidth: own.clientWidth,
    };
  };
  cm.scrollTo = (x, y) => {
    if (x != null) view.scrollDOM.scrollLeft = x;
    if (y != null) {
      const scroller = verticalScroller(view);
      scroller.scrollTop = y + contentOffset(view, scroller);
    }
  };
}
