import { FAKE_SHARE_STORE_KEY } from "../src/forge/fake/fake-share-store";
import { NATIVE_CORE_MARKER } from "../src/native-core/api";
import {
  FAKE_FORGE_BANNER,
  FAKE_FORGE_CONTROLS_KEY,
} from "../src/testing/fake-forge/fake-forge-factory";
import {
  FAKE_FORGE_ARGON2_BINDING,
  FAKE_FORGE_OPTIONS_KEY,
} from "../src/testing/fake-forge/fake-forge-options";
import { FAKE_FORGE_SESSION_PARAM } from "../src/testing/fake-forge/remembered-session";
import { LARGE_TREE_REPO_KEY } from "../src/testing/sample-notes-repo/large-tree-source";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../src/testing/sample-notes-repo/sample-source";
import { FAKE_ANALYTICS_ENDPOINT } from "./build-mode";

export const TAURI_NEEDLES = [
  "__TAURI_INTERNALS__",
  "plugin:opener",
  "plugin:dialog",
  "plugin:fs",
] as const;

export const PROD_LEAK_NEEDLES: readonly string[] = [
  FAKE_FORGE_BANNER,
  SAMPLE_NOTES_REPO_PASSPHRASE,
  FAKE_FORGE_CONTROLS_KEY,
  FAKE_FORGE_OPTIONS_KEY,
  FAKE_FORGE_ARGON2_BINDING,
  FAKE_FORGE_SESSION_PARAM,
  FAKE_SHARE_STORE_KEY,
  LARGE_TREE_REPO_KEY,
  new URL(FAKE_ANALYTICS_ENDPOINT).hostname,
];

export const IOS_VISIT_NEEDLES: readonly string[] = ["/app/ios", "App (iOS)"];

export const LINUX_VISIT_NEEDLES: readonly string[] = [
  "/app/linux",
  "App (Linux)",
];

export const NATIVE_CORE_NEEDLES: readonly string[] = [
  NATIVE_CORE_MARKER,
  "CommitnoteNativeCore",
];
