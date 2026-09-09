export const FORMAT_VERSION = 1;
export const APP_ID = "commitnote";
export const MAIN_BRANCH = "main";

export const REPO_CONFIG_DIR = ".commitnote";
export const REPO_CONFIG_PATH = ".commitnote/config.json";
export const FOLDER_MARKER = ".keep";
export const TRASH_DIR = ".commitnote/trash";
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const CIPHER_ID = "AES-256-GCM";
export const NAME_SCHEME_ID = "AES-256-GCM-SIV-HMAC-SHA256/base64url";
export const KDF_ALGORITHM = "argon2id";

export const NOTE_AAD = "commitnote note v1";
export const NAME_AAD = "commitnote name v1";
export const KEY_CHECK_MESSAGE = "commitnote key check v1";
export const NOTE_PREFIX = "v1:";

export const MAX_NAME_BYTES = 150;

export const HKDF_INFO = {
  contentKey: "commitnote v1 content key",
  nameKey: "commitnote v1 name key",
  nameIvKey: "commitnote v1 name iv key",
  keyCheckKey: "commitnote v1 key check key",
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

export const SAVE_SUBJECT = "commitnote: save";
export const INITIALIZE_SUBJECT = "commitnote: initialize";

export const TRAILER = {
  format: "Commitnote-Format",
  create: "Commitnote-Create",
  update: "Commitnote-Update",
  delete: "Commitnote-Delete",
  rename: "Commitnote-Rename",
  trash: "Commitnote-Trash",
  restore: "Commitnote-Restore",
  purge: "Commitnote-Purge",
} as const;
