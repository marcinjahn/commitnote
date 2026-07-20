import { argon2id } from "hash-wasm";

export interface Argon2idInput {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

export type Argon2idFunction = (input: Argon2idInput) => Promise<Uint8Array>;

export const argon2idDirect: Argon2idFunction = (input) =>
  argon2id({
    password: input.password,
    salt: input.salt,
    iterations: input.iterations,
    parallelism: input.parallelism,
    memorySize: input.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });

export type Argon2WorkerResponse =
  | { readonly ok: true; readonly hash: Uint8Array }
  | { readonly ok: false; readonly message: string };

export const argon2idInWorker: Argon2idFunction = (input) => {
  const worker = new Worker(new URL("./argon2.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<Uint8Array>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<Argon2WorkerResponse>) => {
      const response = event.data;
      if (response.ok) {
        resolve(response.hash);
      } else {
        reject(new Error(response.message));
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message));
    };
    worker.onmessageerror = () => {
      reject(new Error("argon2 worker: message could not be deserialized"));
    };
    worker.postMessage(input);
  }).finally(() => {
    worker.terminate();
  });
};
