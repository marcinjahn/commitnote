export interface BuildModeFacts {
  desktopShell: boolean;
  fakeForge: boolean;
}

export function buildModeFacts(mode: string): BuildModeFacts {
  return {
    desktopShell: mode === "desktop" || mode === "desktop-fake",
    fakeForge: mode === "fake-forge" || mode === "desktop-fake",
  };
}
