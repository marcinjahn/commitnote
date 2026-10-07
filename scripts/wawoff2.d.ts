declare module "wawoff2" {
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
