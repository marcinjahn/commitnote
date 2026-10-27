import { describe, expect, it } from "vitest";
import { createNodeHostServices } from "../testing/node-host-services";
import {
  argon2idDirect,
  argon2idInWorker,
  bindHostArgon2,
} from "./host-argon2";

const input = {
  password: new TextEncoder().encode("commitnote known answer"),
  salt: Uint8Array.from({ length: 16 }, (_, index) => index),
  memoryKiB: 64,
  iterations: 1,
  parallelism: 1,
};

describe("host Argon2id", () => {
  it("rejects until host crypto is bound, then delegates with a 32-byte hash", async () => {
    await expect(argon2idDirect(input)).rejects.toThrow(
      /before host/,
    );
    await expect(argon2idInWorker(input)).rejects.toThrow(/before host/);

    const host = createNodeHostServices();
    const calls: number[] = [];
    bindHostArgon2({
      ...host.crypto,
      argon2id: (request) => {
        calls.push(request.hashLength);
        return host.crypto.argon2id(request);
      },
    });

    const direct = await argon2idDirect(input);
    expect(direct).toHaveLength(32);
    expect(await argon2idInWorker(input)).toEqual(direct);
    expect(calls).toEqual([32, 32]);
  });
});
