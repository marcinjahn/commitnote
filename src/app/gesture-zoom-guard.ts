export function preventGestureZoom(target: EventTarget): () => void {
  const prevent = (event: Event): void => event.preventDefault();
  target.addEventListener("gesturestart", prevent, { passive: false });
  target.addEventListener("gesturechange", prevent, { passive: false });
  return () => {
    target.removeEventListener("gesturestart", prevent);
    target.removeEventListener("gesturechange", prevent);
  };
}
