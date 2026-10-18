let pending: ReturnType<typeof importLightbox> | null = null;

function importLightbox() {
  return import("./ImageLightbox.svelte");
}

export function loadImageLightbox(): ReturnType<typeof importLightbox> {
  pending ??= importLightbox().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
