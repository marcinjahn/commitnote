#!/usr/bin/env python3
import sys
from pathlib import Path

import yaml

RELEASE_APP_ID = "io.github.marcinjahn.commitnote"
TESTING_APP_ID = "io.github.marcinjahn.commitnote.Devel"
MODULE_NAME = "commitnote"
RELEASE_OPTIONS = [
    "-Dprofile=release",
    "-Dcore_bundle=/app/lib/commitnote-build/commitnote-core.js",
]
TESTING_OPTIONS = [
    "-Dprofile=development",
    "-Dtesting=true",
    "-Dcore_bundle=/app/lib/commitnote-build/commitnote-core-fake.js",
]


def fail(message):
    sys.exit(f"testing-manifest.py: {message}")


def config_opts_block(options):
    return "    config-opts:\n" + "".join(f"      - {option}\n" for option in options)


def replace_once(text, old, new, what):
    if text.count(old) != 1:
        fail(f"expected exactly one {what} in the Flatpak manifest")
    return text.replace(old, new)


def find_module(manifest):
    modules = [m for m in manifest.get("modules", []) if isinstance(m, dict) and m.get("name") == MODULE_NAME]
    if len(modules) != 1:
        fail(f"expected exactly one module named {MODULE_NAME}")
    return modules[0]


def main():
    manifest_dir = Path(__file__).resolve().parent
    source_path = manifest_dir / f"{RELEASE_APP_ID}.yml"
    target_path = manifest_dir / f"{TESTING_APP_ID}.yml"

    text = source_path.read_text()
    manifest = yaml.safe_load(text)

    if manifest.get("app-id") != RELEASE_APP_ID:
        fail(f"app-id is not {RELEASE_APP_ID}")
    module = find_module(manifest)
    if module.get("config-opts") != RELEASE_OPTIONS:
        fail(f"config-opts of module {MODULE_NAME} are not {RELEASE_OPTIONS}")

    derived = replace_once(
        text,
        f"app-id: {RELEASE_APP_ID}\n",
        f"app-id: {TESTING_APP_ID}\n",
        "app-id line",
    )
    derived = replace_once(
        derived,
        config_opts_block(RELEASE_OPTIONS),
        config_opts_block(TESTING_OPTIONS),
        "config-opts block",
    )

    expected = yaml.safe_load(text)
    expected["app-id"] = TESTING_APP_ID
    find_module(expected)["config-opts"] = TESTING_OPTIONS
    if yaml.safe_load(derived) != expected:
        fail("the derived manifest differs from the release manifest beyond the expected changes")

    target_path.write_text(derived)


main()
