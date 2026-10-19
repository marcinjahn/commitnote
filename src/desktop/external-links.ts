const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function externalProtocol(href: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function interceptExternalLinks(
  document: Document,
  open: (url: string) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[target="_blank"]');
    if (!anchor || !anchor.href || !externalProtocol(anchor.href)) return;
    event.preventDefault();
    open(anchor.href);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
