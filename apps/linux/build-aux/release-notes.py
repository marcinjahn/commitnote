#!/usr/bin/env python3
"""Print the description of a metainfo release entry as Markdown, for the GitHub release body."""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

MARKDOWN_PUNCTUATION = re.compile(r"([\\`*_\[\]<>&|#~])")
BULLET_MARKER = re.compile(r"[-+]")
ORDERED_MARKER = re.compile(r"^(\d+)(?=[.)])")


def escaped(text: str | None) -> str:
    return MARKDOWN_PUNCTUATION.sub(r"\\\1", text or "")


def code_span(element: ET.Element) -> str:
    if len(element):
        raise ValueError(f"unsupported element <{element[0].tag}> inside <code>")
    code = re.sub(r"\s+", " ", element.text or "").strip()
    fence = "`" * (max((len(run) for run in re.findall(r"`+", code)), default=0) + 1)
    padding = " " if code.startswith("`") or code.endswith("`") else ""
    return f"{fence}{padding}{code}{padding}{fence}"


def inline_text(element: ET.Element) -> str:
    parts = [escaped(element.text)]
    for child in element:
        if child.tag == "code":
            parts.append(code_span(child))
        elif child.tag == "em":
            parts.append(f"*{inline_text(child)}*")
        else:
            raise ValueError(f"unsupported element <{child.tag}> inside <{element.tag}>")
        parts.append(escaped(child.tail))
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def block_text(element: ET.Element) -> str:
    """Inline text that cannot start a list item when it begins a line."""
    text = inline_text(element)
    if BULLET_MARKER.match(text):
        return "\\" + text
    return ORDERED_MARKER.sub(r"\1\\", text, count=1)


def block_markdown(block: ET.Element) -> str:
    if block.tag == "p":
        return block_text(block)
    if block.tag in ("ul", "ol"):
        items = []
        for number, item in enumerate(block, start=1):
            if item.tag != "li":
                raise ValueError(f"unsupported element <{item.tag}> inside <{block.tag}>")
            bullet = f"{number}." if block.tag == "ol" else "-"
            items.append(f"{bullet} {block_text(item)}")
        return "\n".join(items)
    raise ValueError(f"unsupported element <{block.tag}> in a release description")


def release_notes(version: str, metainfo: Path) -> str:
    releases = ET.parse(metainfo).getroot().findall("releases/release")
    release = next((r for r in releases if r.get("version") == version), None)
    if release is None:
        raise ValueError(f"{metainfo.name}: no release entry for version {version}")
    description = release.find("description")
    blocks = [] if description is None else [block_markdown(block) for block in description]
    if not any(blocks):
        raise ValueError(f"{metainfo.name}: the release entry for version {version} has no description")
    return "\n\n".join(blocks) + "\n"


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <version> <metainfo.xml.in>", file=sys.stderr)
        return 2

    try:
        sys.stdout.write(release_notes(sys.argv[1], Path(sys.argv[2])))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
