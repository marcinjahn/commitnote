import { encodeDeviceTrailer } from "../../changes/device-trailer";
import type { Argon2idFunction } from "../../crypto/argon2";
import { asBufferSource, utf8Encode } from "../../crypto/base64";
import { encryptImage, type ImageType } from "../../crypto/image-cipher";
import {
  computeKeyCheck,
  deriveKeyring,
  type Keyring,
} from "../../crypto/keyring";
import { encryptName, encryptPath } from "../../crypto/name-cipher";
import { encryptNote } from "../../crypto/note-cipher";
import { padmeLength } from "../../crypto/padme";
import type { RandomSource } from "../../crypto/random";
import { gitBlobShaOfBytes } from "../../forge/git-blob-sha";
import { HKDF_INFO } from "../../format/v1";
import {
  readImageDimensions,
  sniffImageFormat,
} from "../../images/pipeline/image-format";
import {
  NOTE_IMAGE_PROFILE,
  SHARE_IMAGE_PROFILE,
} from "../../images/pipeline/image-profile";
import { processHostImage } from "../host-image-codec";
import type { HostImageCodec } from "../host-services";
import {
  encryptImageIndex,
  parseImageIndex,
  serializeImageIndex,
} from "../../images/image-index";
import {
  encryptOrderIndex,
  parseOrderIndex,
  serializeOrderIndex,
} from "../../order/order-index";
import { insertImageReferences } from "../../markdown/insertion-rule";
import {
  applyTableCommand,
  availableTableCommands,
} from "../../markdown/table-commands";
import { applyTextEdit, type TextEdit } from "../../markdown/text-edit";
import { sealShare } from "../../share/share-envelope";
import {
  encryptShareIndex,
  parseShareIndex,
  serializeShareIndex,
} from "../../share/share-index";
import {
  encryptTagIndex,
  parseTagIndex,
  serializeTagIndex,
} from "../../tags/tag-index";

export const TEST_VECTOR_FILES = [
  "argon2id.json",
  "primitives.json",
  "keyring.json",
  "names.json",
  "notes.json",
  "images.json",
  "image-pipeline.json",
  "device-trailer.json",
  "shares.json",
  "git-blob-sha1.json",
  "table-commands.json",
  "image-insertion.json",
] as const;

// Vector files are untrusted JSON; a malformed one surfaces as a failed check.
type Json = any;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})*$/.test(hex)) {
    throw new Error("Invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

interface Replay {
  readonly random: RandomSource;
  done(): boolean;
}

function replay(hex: string): Replay {
  const bytes = fromHex(hex);
  let offset = 0;
  return {
    random: (length) => {
      if (offset + length > bytes.length) {
        throw new Error("Replayed random bytes ran out");
      }
      const out = bytes.slice(offset, offset + length);
      offset += length;
      return out;
    },
    done: () => offset === bytes.length,
  };
}

function memoize(argon2id: Argon2idFunction): Argon2idFunction {
  const cache = new Map<string, Promise<Uint8Array>>();
  return (input) => {
    const key = [
      toHex(input.password),
      toHex(input.salt),
      input.memoryKiB,
      input.iterations,
      input.parallelism,
    ].join(":");
    let result = cache.get(key);
    if (result === undefined) {
      result = argon2id(input);
      cache.set(key, result);
    }
    return result.then((bytes) => bytes.slice());
  };
}

async function importRaw(
  hex: string,
  algorithm: "AES-GCM" | "HMAC" | "HKDF",
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asBufferSource(fromHex(hex)),
    algorithm === "HMAC" ? { name: "HMAC", hash: "SHA-256" } : algorithm,
    false,
    usages,
  );
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return toHex(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: asBufferSource(salt),
          info: asBufferSource(info),
        },
        key,
        lengthBytes * 8,
      ),
    ),
  );
}

async function digestHex(
  algorithm: "SHA-1" | "SHA-256",
  dataHex: string,
): Promise<string> {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest(algorithm, asBufferSource(fromHex(dataHex))),
    ),
  );
}

function reproduces(
  text: string,
  edit: TextEdit | null,
  expected: Json,
): boolean {
  if (expected === null) return edit === null;
  return (
    edit !== null &&
    applyTextEdit(text, edit) === expected.text &&
    edit.selection.anchor === expected.selection.anchor &&
    edit.selection.head === expected.selection.head
  );
}

export async function checkTestVectors(
  files: Record<string, unknown>,
  argon2id: Argon2idFunction,
  imageCodec: HostImageCodec,
): Promise<{ checked: number; failures: string[] }> {
  const argon2 = memoize(argon2id);
  const failures: string[] = [];
  let checked = 0;

  async function check(
    label: string,
    run: () => Promise<boolean> | boolean,
  ): Promise<void> {
    checked++;
    let passed = false;
    try {
      passed = (await run()) === true;
    } catch {
      passed = false;
    }
    if (!passed) {
      failures.push(label);
    }
  }

  async function eachVector(
    file: string,
    field: string,
    label: (vector: Json, index: number) => string,
    run: (vector: Json) => Promise<boolean> | boolean,
  ): Promise<void> {
    const content = files[file] as Json;
    const vectors = content?.[field];
    if (!Array.isArray(vectors)) {
      checked++;
      failures.push(`${file}: ${field}`);
      return;
    }
    for (const [index, vector] of vectors.entries()) {
      await check(`${file}: ${label(vector, index)}`, () => run(vector));
    }
  }

  const byIndex =
    (field: string) =>
    (_vector: Json, index: number): string =>
      `${field}[${index}]`;
  const byName = (vector: Json, index: number): string =>
    typeof vector?.name === "string" ? vector.name : `vectors[${index}]`;

  for (const file of TEST_VECTOR_FILES) {
    const content = files[file] as Json;
    await check(`${file}: format`, () => content?.format === 1);
  }

  await eachVector("argon2id.json", "vectors", byName, async (vector) => {
    const output = await argon2({
      password: utf8Encode(vector.password),
      salt: fromHex(vector.saltHex),
      memoryKiB: vector.memoryKiB,
      iterations: vector.iterations,
      parallelism: vector.parallelism,
    });
    return (
      vector.hashLength === output.length && toHex(output) === vector.outputHex
    );
  });

  await eachVector(
    "primitives.json",
    "aesGcm",
    byIndex("aesGcm"),
    async (vector) => {
      const key = await importRaw(vector.keyHex, "AES-GCM", [
        "encrypt",
        "decrypt",
      ]);
      const params = {
        name: "AES-GCM",
        iv: asBufferSource(fromHex(vector.ivHex)),
        additionalData: asBufferSource(fromHex(vector.aadHex)),
      };
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          params,
          key,
          asBufferSource(fromHex(vector.plaintextHex)),
        ),
      );
      const opened = new Uint8Array(
        await crypto.subtle.decrypt(
          params,
          key,
          asBufferSource(fromHex(vector.ciphertextHex)),
        ),
      );
      return (
        toHex(sealed) === vector.ciphertextHex &&
        toHex(opened) === vector.plaintextHex
      );
    },
  );
  await eachVector(
    "primitives.json",
    "hkdfSha256",
    byIndex("hkdfSha256"),
    async (vector) =>
      (await hkdf(
        fromHex(vector.ikmHex),
        fromHex(vector.saltHex),
        fromHex(vector.infoHex),
        vector.lengthBytes,
      )) === vector.okmHex,
  );
  await eachVector(
    "primitives.json",
    "hmacSha256",
    byIndex("hmacSha256"),
    async (vector) => {
      const key = await importRaw(vector.keyHex, "HMAC", ["sign", "verify"]);
      const data = asBufferSource(fromHex(vector.dataHex));
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
      return (
        toHex(mac) === vector.macHex &&
        (await crypto.subtle.verify(
          "HMAC",
          key,
          asBufferSource(fromHex(vector.macHex)),
          data,
        ))
      );
    },
  );
  await eachVector(
    "primitives.json",
    "sha1",
    byIndex("sha1"),
    async (vector) =>
      (await digestHex("SHA-1", vector.dataHex)) === vector.digestHex,
  );
  await eachVector(
    "primitives.json",
    "sha256",
    byIndex("sha256"),
    async (vector) =>
      (await digestHex("SHA-256", vector.dataHex)) === vector.digestHex,
  );

  const keyrings = new Map<string, Promise<Keyring>>();
  function keyringNamed(name: unknown): Promise<Keyring> {
    let keyring = keyrings.get(String(name));
    if (keyring === undefined) {
      const vectors = (files["keyring.json"] as Json)?.vectors;
      const vector = Array.isArray(vectors)
        ? vectors.find((candidate: Json) => candidate?.name === name)
        : undefined;
      keyring =
        vector === undefined
          ? Promise.reject(new Error("Unknown keyring"))
          : deriveKeyring(
              vector.passphrase,
              {
                algorithm: "argon2id",
                salt: fromHex(vector.kdf.saltHex),
                memoryKiB: vector.kdf.memoryKiB,
                iterations: vector.kdf.iterations,
                parallelism: vector.kdf.parallelism,
              },
              argon2,
            );
      keyring.catch(() => undefined);
      keyrings.set(String(name), keyring);
    }
    return keyring;
  }

  await eachVector("keyring.json", "vectors", byName, async (vector) => {
    const keyring = await keyringNamed(vector.name);
    if ((await computeKeyCheck(keyring)) !== vector.keyCheck) {
      return false;
    }
    const master = await argon2({
      password: utf8Encode(String(vector.passphrase).normalize("NFC")),
      salt: fromHex(vector.kdf.saltHex),
      memoryKiB: vector.kdf.memoryKiB,
      iterations: vector.kdf.iterations,
      parallelism: vector.kdf.parallelism,
    });
    if (toHex(master) !== vector.masterSecretHex) {
      return false;
    }
    const empty = new Uint8Array(0);
    for (const [info, hex] of [
      [HKDF_INFO.contentKey, vector.contentKeyHex],
      [HKDF_INFO.nameKey, vector.nameKeyHex],
      [HKDF_INFO.nameIvKey, vector.nameIvKeyHex],
      [HKDF_INFO.keyCheckKey, vector.keyCheckKeyHex],
    ]) {
      if ((await hkdf(master, empty, utf8Encode(info), 32)) !== hex) {
        return false;
      }
    }
    const imported: Keyring = {
      contentKey: await importRaw(vector.contentKeyHex, "AES-GCM", [
        "encrypt",
        "decrypt",
      ]),
      nameKey: await importRaw(vector.nameKeyHex, "AES-GCM", [
        "encrypt",
        "decrypt",
      ]),
      nameIvKey: await importRaw(vector.nameIvKeyHex, "HMAC", [
        "sign",
        "verify",
      ]),
      keyCheckKey: await importRaw(vector.keyCheckKeyHex, "HMAC", [
        "sign",
        "verify",
      ]),
    };
    return (await computeKeyCheck(imported)) === vector.keyCheck;
  });

  const keyringOf = (file: string) =>
    keyringNamed((files[file] as Json)?.keyring);

  await eachVector(
    "names.json",
    "segments",
    byIndex("segments"),
    async (vector) =>
      (await encryptName(await keyringOf("names.json"), vector.name)) ===
      vector.segment,
  );
  await eachVector(
    "names.json",
    "paths",
    byIndex("paths"),
    async (vector) =>
      (await encryptPath(await keyringOf("names.json"), vector.path)) ===
      vector.storedPath,
  );

  await eachVector("notes.json", "notes", byIndex("notes"), async (vector) => {
    const source = replay(vector.randomHex);
    const stored = await encryptNote(
      await keyringOf("notes.json"),
      vector.markdown,
      source.random,
    );
    return stored === vector.stored && source.done();
  });
  const indexCodecs: Record<
    string,
    (
      keyring: Keyring,
      serialized: string,
      random: RandomSource,
    ) => { reserialized: string; stored: Promise<string> }
  > = {
    order: (keyring, serialized, random) => {
      const index = parseOrderIndex(serialized);
      return {
        reserialized: serializeOrderIndex(index),
        stored: encryptOrderIndex(keyring, index, random),
      };
    },
    tags: (keyring, serialized, random) => {
      const index = parseTagIndex(serialized);
      return {
        reserialized: serializeTagIndex(index),
        stored: encryptTagIndex(keyring, index, random),
      };
    },
    images: (keyring, serialized, random) => {
      const index = parseImageIndex(serialized);
      return {
        reserialized: serializeImageIndex(index),
        stored: encryptImageIndex(keyring, index, random),
      };
    },
    shares: (keyring, serialized, random) => {
      const index = parseShareIndex(serialized);
      return {
        reserialized: serializeShareIndex(index),
        stored: encryptShareIndex(keyring, index, random),
      };
    },
  };
  await eachVector(
    "notes.json",
    "indexes",
    (vector, index) =>
      typeof vector?.kind === "string"
        ? `indexes.${vector.kind}`
        : `indexes[${index}]`,
    async (vector) => {
      const codec = Object.hasOwn(indexCodecs, vector.kind)
        ? indexCodecs[vector.kind]
        : undefined;
      if (codec === undefined) {
        return false;
      }
      const source = replay(vector.randomHex);
      const { reserialized, stored } = codec(
        await keyringOf("notes.json"),
        vector.serialized,
        source.random,
      );
      return (
        reserialized === vector.serialized &&
        (await stored) === vector.stored &&
        source.done()
      );
    },
  );

  await eachVector(
    "images.json",
    "padme",
    (vector, index) =>
      typeof vector?.length === "number"
        ? `padme[${vector.length}]`
        : `padme[${index}]`,
    (vector) => padmeLength(vector.length) === vector.padded,
  );
  await eachVector(
    "images.json",
    "images",
    byIndex("images"),
    async (vector) => {
      const source = replay(vector.randomHex);
      const envelope = await encryptImage(
        await keyringOf("images.json"),
        vector.imageId,
        {
          type: vector.type as ImageType,
          width: vector.width,
          height: vector.height,
          bytes: fromHex(vector.bytesHex),
        },
        source.random,
      );
      return toHex(envelope) === vector.envelopeHex && source.done();
    },
  );

  await eachVector(
    "device-trailer.json",
    "trailers",
    byIndex("trailers"),
    async (vector) => {
      const source = replay(vector.randomHex);
      const keyring = await keyringOf("device-trailer.json");
      const value = await encodeDeviceTrailer(
        vector.name,
        keyring.contentKey,
        source.random,
      );
      return value === vector.value && source.done();
    },
  );

  await eachVector("shares.json", "shares", byName, async (vector) => {
    const input = vector.input;
    const source = replay(vector.randomHex);
    const sealed = await sealShare({
      name: input.name,
      markdown: input.markdown,
      sharedAt: input.sharedAt,
      updatedAt: input.updatedAt,
      linkSecret: input.linkSecret,
      ...(input.password === null ? {} : { password: input.password }),
      images: input.images.map((image: Json) => ({
        imageId: image.imageId,
        payload: {
          type: image.type as ImageType,
          width: image.width,
          height: image.height,
          bytes: fromHex(image.bytesHex),
        },
      })),
      random: source.random,
      argon2id: argon2,
    });
    return (
      sealed.kind === "sealed" &&
      sealed.envelope === vector.envelope &&
      sealed.images.length === vector.imageFiles.length &&
      sealed.images.every((file, index) => file === vector.imageFiles[index]) &&
      source.done()
    );
  });

  await eachVector("image-pipeline.json", "cases", byName, async (vector) => {
    const profile =
      vector.profile === "note"
        ? NOTE_IMAGE_PROFILE
        : vector.profile === "share"
          ? SHARE_IMAGE_PROFILE
          : null;
    if (profile === null || typeof vector.input.type !== "string") return false;
    const input = fromHex(vector.input.bytesHex);
    const result = await processHostImage(
      imageCodec,
      new Blob([asBufferSource(input)], { type: vector.input.type }),
      profile,
    );
    const expected = vector.expect;
    if (!result.ok) {
      return (
        expected.kind === "rejected" &&
        result.rejection.kind === expected.rejection
      );
    }
    const { payload } = result;
    if (expected.kind === "gif") {
      return (
        payload.type === "image/gif" &&
        toHex(payload.bytes) === expected.bytesHex
      );
    }
    if (expected.kind !== "webp" || payload.type !== "image/webp") return false;
    const dimensions = readImageDimensions(payload.bytes, "webp");
    return (
      payload.width === expected.width &&
      payload.height === expected.height &&
      sniffImageFormat(payload.bytes) === "webp" &&
      dimensions?.width === expected.width &&
      dimensions?.height === expected.height &&
      payload.bytes.length <= profile.maxBytes
    );
  });

  await eachVector(
    "git-blob-sha1.json",
    "vectors",
    byIndex("vectors"),
    async (vector) =>
      (await gitBlobShaOfBytes(fromHex(vector.contentHex))) === vector.sha,
  );

  await eachVector("table-commands.json", "commands", byName, (vector) =>
    reproduces(
      vector.text,
      applyTableCommand(
        vector.text,
        vector.selection,
        vector.command,
        vector.argument,
      ),
      vector.expected,
    ),
  );
  await eachVector("table-commands.json", "availability", byName, (vector) => {
    const available = availableTableCommands(vector.text, vector.selection);
    return (
      Array.isArray(vector.available) &&
      available.length === vector.available.length &&
      available.every((command, index) => command === vector.available[index])
    );
  });

  await eachVector("image-insertion.json", "insertions", byName, (vector) =>
    reproduces(
      vector.text,
      vector.command === "insert-image-references"
        ? insertImageReferences(
            vector.text,
            vector.selection.head,
            vector.argument,
          )
        : null,
      vector.expected,
    ),
  );

  return { checked, failures };
}
