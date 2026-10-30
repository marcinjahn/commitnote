import { notePathEquals, type NotePath } from "../changes/change";
import type { ImageId } from "./image-id";
import type { ImageIndex } from "./image-index";

export function noteOwnsImage(
  images: ImageIndex | null | undefined,
  path: NotePath | null,
  id: ImageId,
): boolean {
  if (path === null) return false;
  const owners = images?.images.get(id)?.owners ?? [];
  return owners.some((owner) => owner.state === "active" && notePathEquals(owner.path, path));
}
