let pending: ReturnType<typeof importPipeline> | null = null;

function importPipeline() {
  return import("./pipeline/index");
}

export function loadImagePipeline(): ReturnType<typeof importPipeline> {
  pending ??= importPipeline().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
