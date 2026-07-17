export const FORMAT_VERSION = 1;
export const APP_ID = "git-notes";
export const MAIN_BRANCH = "main";

export const REPO_CONFIG_DIR = ".gitnotes";
export const REPO_CONFIG_PATH = ".gitnotes/config.json";
export const FOLDER_MARKER = ".keep";

export const CIPHER_ID = "AES-256-GCM";
export const NAME_SCHEME_ID = "AES-256-GCM-SIV-HMAC-SHA256/base64url";
export const KDF_ALGORITHM = "argon2id";

export const NOTE_AAD = "git-notes note v1";
export const NAME_AAD = "git-notes name v1";
export const KEY_CHECK_MESSAGE = "git-notes key check v1";
export const NOTE_PREFIX = "v1:";

export const MAX_NAME_BYTES = 150;

export const HKDF_INFO = {
  contentKey: "git-notes v1 content key",
  nameKey: "git-notes v1 name key",
  nameIvKey: "git-notes v1 name iv key",
  keyCheckKey: "git-notes v1 key check key",
} as const;

export const KDF_DEFAULTS = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
} as const;

export const KDF_LIMITS = {
  minMemoryKiB: 65536,
  maxMemoryKiB: 1048576,
  minIterations: 3,
  maxIterations: 10,
  minParallelism: 1,
  saltBytes: 16,
} as const;

export const SAVE_SUBJECT = "git-notes: save";
export const INITIALIZE_SUBJECT = "git-notes: initialize";

export const TRAILER = {
  format: "Gitnotes-Format",
  create: "Gitnotes-Create",
  update: "Gitnotes-Update",
  delete: "Gitnotes-Delete",
  rename: "Gitnotes-Rename",
} as const;
