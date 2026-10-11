type ExternalOpener = (url: string) => void;

const defaultOpener: ExternalOpener = (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

let opener: ExternalOpener = defaultOpener;

export function openExternal(url: string): void {
  opener(url);
}

export function setExternalOpener(open: ExternalOpener): void {
  opener = open;
}

export function resetExternalOpener(): void {
  opener = defaultOpener;
}
