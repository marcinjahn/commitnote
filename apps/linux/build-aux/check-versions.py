#!/usr/bin/env python3
"""Check that the crate versions and the newest release entry follow the meson version."""

import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path


def package_version(manifest: Path) -> str | None:
    package = tomllib.loads(manifest.read_text(encoding="utf-8")).get("package", {})
    version = package.get("version")
    return version if isinstance(version, str) else None


def crate_problems(expected: str, workspace_manifest: Path) -> list[str]:
    manifests = [("commitnote", workspace_manifest)]
    members = tomllib.loads(workspace_manifest.read_text(encoding="utf-8"))["workspace"]["members"]
    for member in members:
        manifests.append((member, workspace_manifest.parent / member / "Cargo.toml"))

    problems = []
    for name, manifest in manifests:
        if not manifest.is_file():
            problems.append(f"crate {name}: {manifest} does not exist")
            continue
        version = package_version(manifest)
        if version is None:
            problems.append(f"crate {name}: no literal version in {manifest}")
        elif version != expected:
            problems.append(f"crate {name}: version is {version}, expected {expected}")
    return problems


def release_problems(expected: str, metainfo: Path) -> list[str]:
    release = ET.parse(metainfo).getroot().find("releases/release")
    if release is None:
        return [f"{metainfo.name}: no release entry"]

    problems = []
    version = release.get("version")
    if version != expected:
        problems.append(f"{metainfo.name}: newest release is {version}, expected {expected}")
    description = release.find("description")
    if description is None or not "".join(description.itertext()).strip():
        problems.append(f"{metainfo.name}: newest release has no description")
    return problems


def main() -> int:
    if len(sys.argv) != 4:
        print(f"usage: {sys.argv[0]} <version> <workspace Cargo.toml> <metainfo.xml.in>", file=sys.stderr)
        return 2

    expected, workspace_manifest, metainfo = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    problems = crate_problems(expected, workspace_manifest) + release_problems(expected, metainfo)
    for problem in problems:
        print(problem)
    if problems:
        return 1
    print(f"all crates and the newest release follow version {expected}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
