export interface BuildModeFacts {
  fakeForge: boolean;
}

export function buildModeFacts(mode: string): BuildModeFacts {
  return {
    fakeForge: mode === "fake-forge" || mode === "native-core-fake",
  };
}
