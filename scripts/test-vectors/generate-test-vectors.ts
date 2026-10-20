import { argon2idDirect, type Argon2idFunction } from "../../src/crypto/argon2";
import { toBase64Url, utf8Encode } from "../../src/crypto/base64";
import { encryptImage, type ImagePayload } from "../../src/crypto/image-cipher";
import {
  computeKeyCheck,
  deriveKeyring,
  type Keyring,
} from "../../src/crypto/keyring";
import { encryptName, encryptPath } from "../../src/crypto/name-cipher";
import { encryptNote } from "../../src/crypto/note-cipher";
import { padmeLength } from "../../src/crypto/padme";
import type { RandomSource } from "../../src/crypto/random";
import type { KdfParams } from "../../src/crypto/repo-config";
import { encodeDeviceTrailer } from "../../src/changes/device-trailer";
import { gitBlobShaOfBytes } from "../../src/forge/git-blob-sha";
import {
  HKDF_INFO,
  KDF_DEFAULTS,
  KEY_CHECK_MESSAGE,
} from "../../src/format/v1";
import {
  encryptImageIndex,
  serializeImageIndex,
  type ImageIndex,
} from "../../src/images/image-index";
import {
  encryptOrderIndex,
  folderKey,
  serializeOrderIndex,
  type OrderIndex,
} from "../../src/order/order-index";
import { sealShare } from "../../src/share/share-envelope";
import {
  encryptShareIndex,
  serializeShareIndex,
  type ShareIndex,
} from "../../src/share/share-index";
import {
  encryptTagIndex,
  serializeTagIndex,
  tagKey,
  type TagIndex,
} from "../../src/tags/tag-index";
import { createSeededRandom } from "../../src/testing/sample-notes-repo/seeded-random";

export const KEYRING_PASSPHRASE = "commitnote known answer";
export const KEYRING_SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
export const KEYRING_A_PARAMS = {
  memoryKiB: 1024,
  iterations: 1,
  parallelism: 1,
} as const;
export const KEYRING_B_PARAMS = KDF_DEFAULTS;

const FORMAT = 1;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function pattern(length: number, start: number, step = 1): Uint8Array {
  return Uint8Array.from(
    { length },
    (_, index) => (start + index * step) & 0xff,
  );
}

interface RecordingRandom {
  readonly random: RandomSource;
  hex(): string;
}

function recordingRandom(seed: number): RecordingRandom {
  const source = createSeededRandom(seed);
  const drawn: number[] = [];
  return {
    random: (length) => {
      const bytes = source(length);
      drawn.push(...bytes);
      return bytes;
    },
    hex: () => toHex(Uint8Array.from(drawn)),
  };
}

export function memoizeArgon2id(argon2id: Argon2idFunction): Argon2idFunction {
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

function kdfParams(
  sizing: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism">,
): KdfParams {
  return { algorithm: "argon2id", salt: KEYRING_SALT, ...sizing };
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as BufferSource,
        info: info as BufferSource,
      },
      key,
      lengthBytes * 8,
    ),
  );
}

async function argon2Vectors(argon2id: Argon2idFunction) {
  const inputs = [
    {
      name: "reduced-ascii",
      password: KEYRING_PASSPHRASE,
      salt: KEYRING_SALT,
      ...KEYRING_A_PARAMS,
    },
    {
      name: "reduced-non-ascii",
      password: "Zażółć gęślą jaźń",
      salt: new Uint8Array(16).fill(0x2a),
      memoryKiB: 64,
      iterations: 1,
      parallelism: 1,
    },
    {
      name: "default",
      password: KEYRING_PASSPHRASE,
      salt: KEYRING_SALT,
      ...KEYRING_B_PARAMS,
    },
  ];
  const vectors = [];
  for (const input of inputs) {
    const output = await argon2id({
      password: utf8Encode(input.password),
      salt: input.salt,
      memoryKiB: input.memoryKiB,
      iterations: input.iterations,
      parallelism: input.parallelism,
    });
    vectors.push({
      name: input.name,
      password: input.password,
      saltHex: toHex(input.salt),
      memoryKiB: input.memoryKiB,
      iterations: input.iterations,
      parallelism: input.parallelism,
      hashLength: 32,
      outputHex: toHex(output),
    });
  }
  return { format: FORMAT, vectors };
}

async function primitiveVectors() {
  const subtle = crypto.subtle;
  const aesInputs = [
    {
      key: pattern(32, 0),
      iv: pattern(12, 0x10),
      aad: utf8Encode("commitnote"),
      plaintext: utf8Encode("The quick brown fox"),
    },
    {
      key: pattern(32, 0x80, 3),
      iv: pattern(12, 0xa0, 5),
      aad: new Uint8Array(0),
      plaintext: pattern(100, 7, 11),
    },
    {
      key: pattern(32, 0xff, -1),
      iv: pattern(12, 1, 2),
      aad: pattern(20, 0x40),
      plaintext: new Uint8Array(0),
    },
  ];
  const aesGcm = [];
  for (const input of aesInputs) {
    const key = await subtle.importKey(
      "raw",
      input.key as BufferSource,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const ciphertext = new Uint8Array(
      await subtle.encrypt(
        {
          name: "AES-GCM",
          iv: input.iv as BufferSource,
          additionalData: input.aad as BufferSource,
        },
        key,
        input.plaintext as BufferSource,
      ),
    );
    aesGcm.push({
      keyHex: toHex(input.key),
      ivHex: toHex(input.iv),
      aadHex: toHex(input.aad),
      plaintextHex: toHex(input.plaintext),
      ciphertextHex: toHex(ciphertext),
    });
  }

  const hkdfInputs = [
    {
      ikm: pattern(22, 0x0b, 0),
      salt: pattern(13, 0),
      info: pattern(10, 0xf0),
      lengthBytes: 42,
    },
    { ikm: pattern(32, 0), salt: new Uint8Array(0), info: new Uint8Array(0), lengthBytes: 32 },
    {
      ikm: pattern(32, 9, 7),
      salt: new Uint8Array(0),
      info: utf8Encode(HKDF_INFO.contentKey),
      lengthBytes: 32,
    },
    {
      ikm: pattern(40, 3, 5),
      salt: pattern(16, 0x55, 0),
      info: utf8Encode("commitnote share v1 key"),
      lengthBytes: 16,
    },
  ];
  const hkdfSha256 = [];
  for (const input of hkdfInputs) {
    hkdfSha256.push({
      ikmHex: toHex(input.ikm),
      saltHex: toHex(input.salt),
      infoHex: toHex(input.info),
      lengthBytes: input.lengthBytes,
      okmHex: toHex(
        await hkdf(input.ikm, input.salt, input.info, input.lengthBytes),
      ),
    });
  }

  const hmacInputs = [
    { key: pattern(32, 0), data: utf8Encode(KEY_CHECK_MESSAGE) },
    { key: pattern(32, 0x20, 3), data: new Uint8Array(0) },
    { key: pattern(32, 0xff, -1), data: pattern(200, 0, 1) },
  ];
  const hmacSha256 = [];
  for (const input of hmacInputs) {
    const key = await subtle.importKey(
      "raw",
      input.key as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    hmacSha256.push({
      keyHex: toHex(input.key),
      dataHex: toHex(input.data),
      macHex: toHex(
        new Uint8Array(await subtle.sign("HMAC", key, input.data as BufferSource)),
      ),
    });
  }

  const digestInputs = [
    new Uint8Array(0),
    utf8Encode("abc"),
    pattern(256, 0),
    pattern(1000, 3, 7),
  ];
  const sha1 = [];
  const sha256 = [];
  for (const data of digestInputs) {
    sha1.push({
      dataHex: toHex(data),
      digestHex: toHex(
        new Uint8Array(await subtle.digest("SHA-1", data as BufferSource)),
      ),
    });
    sha256.push({
      dataHex: toHex(data),
      digestHex: toHex(
        new Uint8Array(await subtle.digest("SHA-256", data as BufferSource)),
      ),
    });
  }

  return { format: FORMAT, aesGcm, hkdfSha256, hmacSha256, sha1, sha256 };
}

async function importRawKeyring(raw: {
  contentKey: Uint8Array;
  nameKey: Uint8Array;
  nameIvKey: Uint8Array;
  keyCheckKey: Uint8Array;
}): Promise<Keyring> {
  const subtle = crypto.subtle;
  const aes = (bytes: Uint8Array) =>
    subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  const hmac = (bytes: Uint8Array) =>
    subtle.importKey(
      "raw",
      bytes as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  return {
    contentKey: await aes(raw.contentKey),
    nameKey: await aes(raw.nameKey),
    nameIvKey: await hmac(raw.nameIvKey),
    keyCheckKey: await hmac(raw.keyCheckKey),
  };
}

async function keyringVector(
  name: "A" | "B",
  sizing: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism">,
  argon2id: Argon2idFunction,
) {
  const kdf = kdfParams(sizing);
  const keyring = await deriveKeyring(KEYRING_PASSPHRASE, kdf, argon2id);
  const keyCheck = await computeKeyCheck(keyring);

  const master = await argon2id({
    password: utf8Encode(KEYRING_PASSPHRASE.normalize("NFC")),
    salt: kdf.salt,
    memoryKiB: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
  });
  const derive = (info: string) =>
    hkdf(master, new Uint8Array(0), utf8Encode(info), 32);
  const raw = {
    contentKey: await derive(HKDF_INFO.contentKey),
    nameKey: await derive(HKDF_INFO.nameKey),
    nameIvKey: await derive(HKDF_INFO.nameIvKey),
    keyCheckKey: await derive(HKDF_INFO.keyCheckKey),
  };

  const imported = await importRawKeyring(raw);
  const probeRandom = createSeededRandom(1);
  const probe = "key probe";
  const probeIv = probeRandom(12);
  const matches =
    (await computeKeyCheck(imported)) === keyCheck &&
    (await encryptName(imported, probe)) === (await encryptName(keyring, probe)) &&
    (await encryptNote(imported, probe, () => probeIv)) ===
      (await encryptNote(keyring, probe, () => probeIv));
  if (!matches) {
    throw new Error(`Raw keys do not reproduce keyring ${name}`);
  }

  return {
    keyring,
    vector: {
      name,
      passphrase: KEYRING_PASSPHRASE,
      kdf: {
        memoryKiB: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
        saltHex: toHex(kdf.salt),
      },
      masterSecretHex: toHex(master),
      contentKeyHex: toHex(raw.contentKey),
      nameKeyHex: toHex(raw.nameKey),
      nameIvKeyHex: toHex(raw.nameIvKey),
      keyCheckKeyHex: toHex(raw.keyCheckKey),
      keyCheck,
    },
  };
}

export const NAME_150_BYTES = "ż".repeat(75);

export const NAME_INPUTS = [
  "Projects",
  "Zażółć gęślą jaźń",
  "a",
  "📝 Ideas",
  NAME_150_BYTES,
  "é",
];

export const PATH_INPUTS = [
  ["Projects", "commitnote", "Ideas"],
  ["Zażółć", "gęślą", "📝 Ideas"],
];

async function namesFile(keyring: Keyring) {
  const segments = [];
  for (const name of NAME_INPUTS) {
    segments.push({ name, segment: await encryptName(keyring, name) });
  }
  const paths = [];
  for (const path of PATH_INPUTS) {
    paths.push({ path, storedPath: await encryptPath(keyring, path) });
  }
  return { format: FORMAT, keyring: "A", segments, paths };
}

export const NOTE_MARKDOWNS = [
  "",
  "Hello, world.",
  "# Zażółć gęślą jaźń\n\nLine two with 📝 and é.\n\n- item one\n- item two\n",
];

const ORDER_INDEX: OrderIndex = {
  writable: true,
  folders: new Map([
    [
      folderKey([]),
      new Map([
        ["Ideas", "8"],
        ["Projects", "V"],
        ["Zażółć", "k"],
      ]),
    ],
    [
      folderKey(["Projects"]),
      new Map([
        ["commitnote", "V"],
        ["notes.md", "k"],
      ]),
    ],
  ]),
};

const TAG_INDEX: TagIndex = {
  writable: true,
  notes: new Map([
    [tagKey(["Projects", "commitnote"]), { color: "blue" }],
    [tagKey(["Ideas"]), { color: "green" }],
  ]),
  trash: new Map([
    ["trash-entry-1", new Map([[tagKey([]), { color: "red" }]])],
  ]),
};

const IMAGE_ID_1 = "abcdefghijklmnopqrstuvwxyz";
const IMAGE_ID_2 = "7777777777777777aaaaaaaaaa";
const IMAGE_ID_3 = "bbbbbbbbbbbbbbbb2222222222";

const IMAGE_INDEX: ImageIndex = {
  writable: true,
  images: new Map([
    [
      IMAGE_ID_1,
      {
        blobSha: "0123456789abcdef0123456789abcdef01234567",
        owners: [
          { state: "active", path: ["Projects", "commitnote"] },
          { state: "trashed", entryId: "trash-entry-1", path: [] },
        ],
      },
    ],
  ]),
  tombstones: new Map([
    [
      IMAGE_ID_2,
      {
        blobSha: "89abcdef0123456789abcdef0123456789abcdef",
        removedAt: 1767225600000,
      },
    ],
  ]),
};

const SHARE_LINK_SECRET = toBase64Url(pattern(32, 0x30));

const SHARE_INDEX: ShareIndex = {
  writable: true,
  entries: new Map([
    [
      "c2hhcmUtaWQtMDAwMDAwMQ",
      {
        id: "c2hhcmUtaWQtMDAwMDAwMQ",
        locator: { provider: "github", gistId: "0123456789abcdef" },
        linkSecret: SHARE_LINK_SECRET,
        password: null,
        name: "Projects note",
        label: null,
        sharedAt: "2026-01-01T00:00:00.000Z",
        note: { state: "active", path: ["Projects", "commitnote"] },
        source: {
          commit: "0123456789abcdef0123456789abcdef01234567",
          storedPath: "abc/def",
          blobSha: "89abcdef0123456789abcdef0123456789abcdef",
        },
        updatedAt: null,
      },
    ],
    [
      "c2hhcmUtaWQtMDAwMDAwMg",
      {
        id: "c2hhcmUtaWQtMDAwMDAwMg",
        locator: { provider: "gitlab", snippetId: "42" },
        linkSecret: SHARE_LINK_SECRET,
        password: "share password",
        name: "Zażółć",
        label: "for the team",
        sharedAt: "2026-01-01T00:00:00.000Z",
        note: { state: "trashed", entryId: "trash-entry-1", path: ["a"] },
        source: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  ]),
};

async function notesFile(keyring: Keyring) {
  const notes = [];
  for (const [index, markdown] of NOTE_MARKDOWNS.entries()) {
    const recorder = recordingRandom(100 + index);
    const stored = await encryptNote(keyring, markdown, recorder.random);
    notes.push({ markdown, randomHex: recorder.hex(), stored });
  }

  const indexes: Record<string, string>[] = [];
  const add = async (
    kind: string,
    serialized: string,
    seed: number,
    encrypt: (random: RandomSource) => Promise<string>,
  ) => {
    const recorder = recordingRandom(seed);
    const stored = await encrypt(recorder.random);
    indexes.push({ kind, serialized, randomHex: recorder.hex(), stored });
  };
  await add("order", serializeOrderIndex(ORDER_INDEX), 200, (random) =>
    encryptOrderIndex(keyring, ORDER_INDEX, random),
  );
  await add("tags", serializeTagIndex(TAG_INDEX), 201, (random) =>
    encryptTagIndex(keyring, TAG_INDEX, random),
  );
  await add("images", serializeImageIndex(IMAGE_INDEX), 202, (random) =>
    encryptImageIndex(keyring, IMAGE_INDEX, random),
  );
  await add("shares", serializeShareIndex(SHARE_INDEX), 203, (random) =>
    encryptShareIndex(keyring, SHARE_INDEX, random),
  );
  return { format: FORMAT, keyring: "A", notes, indexes };
}

export const PADME_LENGTHS = [0, 1, 2, 3, 100, 1000, 65537, 1000000];

export interface TestImage {
  readonly imageId: string;
  readonly payload: ImagePayload;
}

export const TEST_IMAGES: readonly TestImage[] = [
  {
    imageId: IMAGE_ID_1,
    payload: {
      type: "image/webp",
      width: 2,
      height: 3,
      bytes: pattern(10, 0x52, 7),
    },
  },
  {
    imageId: IMAGE_ID_3,
    payload: {
      type: "image/gif",
      width: 7,
      height: 5,
      bytes: pattern(300, 0x47, 13),
    },
  },
];

async function imagesFile(keyring: Keyring) {
  const padme = PADME_LENGTHS.map((length) => ({
    length,
    padded: padmeLength(length),
  }));
  const images = [];
  for (const [index, image] of TEST_IMAGES.entries()) {
    const recorder = recordingRandom(300 + index);
    const envelope = await encryptImage(
      keyring,
      image.imageId,
      image.payload,
      recorder.random,
    );
    images.push({
      imageId: image.imageId,
      type: image.payload.type,
      width: image.payload.width,
      height: image.payload.height,
      bytesHex: toHex(image.payload.bytes),
      randomHex: recorder.hex(),
      envelopeHex: toHex(envelope),
    });
  }
  return { format: FORMAT, keyring: "A", padme, images };
}

export const DEVICE_NAMES = ["Chrome on Linux", "iPhone", "Zażółć"];

async function deviceTrailerFile(keyring: Keyring) {
  const trailers = [];
  for (const [index, name] of DEVICE_NAMES.entries()) {
    const recorder = recordingRandom(400 + index);
    const value = await encodeDeviceTrailer(
      name,
      keyring.contentKey,
      recorder.random,
    );
    trailers.push({ name, randomHex: recorder.hex(), value });
  }
  return { format: FORMAT, keyring: "A", trailers };
}

interface ShareCase {
  readonly name: string;
  readonly markdown: string;
  readonly password: string | null;
  readonly updatedAt: string | null;
  readonly images: readonly TestImage[];
}

export const SHARE_CASES: readonly ShareCase[] = [
  {
    name: "no-password",
    markdown: "Shared note\n\nWith **markdown**.",
    password: null,
    updatedAt: null,
    images: [],
  },
  {
    name: "password",
    markdown: "Zażółć gęślą jaźń 📝",
    password: "share password",
    updatedAt: "2026-01-02T00:00:00.000Z",
    images: [],
  },
  {
    name: "with-images",
    markdown: "Note with pictures\n\n![a](image-0)\n\n![b](image-1)",
    password: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    images: TEST_IMAGES,
  },
];

export const SHARE_SHARED_AT = "2026-01-01T00:00:00.000Z";
export { SHARE_LINK_SECRET };

async function sharesFile(argon2id: Argon2idFunction) {
  const shares = [];
  for (const [index, shareCase] of SHARE_CASES.entries()) {
    const recorder = recordingRandom(500 + index);
    const sealed = await sealShare({
      name: shareCase.name,
      markdown: shareCase.markdown,
      sharedAt: SHARE_SHARED_AT,
      updatedAt: shareCase.updatedAt,
      linkSecret: SHARE_LINK_SECRET,
      ...(shareCase.password === null ? {} : { password: shareCase.password }),
      images: shareCase.images,
      random: recorder.random,
      argon2id,
    });
    if (sealed.kind !== "sealed") {
      throw new Error(`Share vector ${shareCase.name} was not sealed`);
    }
    shares.push({
      name: shareCase.name,
      input: {
        name: shareCase.name,
        markdown: shareCase.markdown,
        sharedAt: SHARE_SHARED_AT,
        updatedAt: shareCase.updatedAt,
        linkSecret: SHARE_LINK_SECRET,
        password: shareCase.password,
        images: shareCase.images.map((image) => ({
          imageId: image.imageId,
          type: image.payload.type,
          width: image.payload.width,
          height: image.payload.height,
          bytesHex: toHex(image.payload.bytes),
        })),
      },
      randomHex: recorder.hex(),
      envelope: sealed.envelope,
      imageFiles: [...sealed.images],
    });
  }
  return { format: FORMAT, shares };
}

async function gitBlobFile(noteEnvelope: string) {
  const contents = [
    new Uint8Array(0),
    utf8Encode("hello\n"),
    pattern(256, 0),
    utf8Encode(noteEnvelope),
  ];
  const vectors = [];
  for (const content of contents) {
    vectors.push({
      contentHex: toHex(content),
      sha: await gitBlobShaOfBytes(content),
    });
  }
  return { format: FORMAT, vectors };
}

export async function generateTestVectors(
  argon2id: Argon2idFunction = memoizeArgon2id(argon2idDirect),
): Promise<Record<string, unknown>> {
  const a = await keyringVector("A", KEYRING_A_PARAMS, argon2id);
  const b = await keyringVector("B", KEYRING_B_PARAMS, argon2id);
  const notes = await notesFile(a.keyring);
  const asciiNote = notes.notes[1];

  return {
    "argon2id.json": await argon2Vectors(argon2id),
    "primitives.json": await primitiveVectors(),
    "keyring.json": { format: FORMAT, vectors: [a.vector, b.vector] },
    "names.json": await namesFile(a.keyring),
    "notes.json": notes,
    "images.json": await imagesFile(a.keyring),
    "device-trailer.json": await deviceTrailerFile(a.keyring),
    "shares.json": await sharesFile(argon2id),
    "git-blob-sha1.json": await gitBlobFile(asciiNote.stored),
  };
}
