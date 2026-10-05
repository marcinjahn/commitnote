import { utf8Encode } from "../crypto/base64";

export async function gitBlobSha(text: string): Promise<string> {
  const content = utf8Encode(text);
  const header = utf8Encode(`blob ${content.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + content.byteLength);
  bytes.set(header, 0);
  bytes.set(content, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
