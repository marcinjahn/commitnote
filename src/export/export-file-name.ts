export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `commitnote-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}
