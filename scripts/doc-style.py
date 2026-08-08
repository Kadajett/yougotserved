#!/usr/bin/env python3
"""Check docs and web copy against the project writing rules.

Usage: python3 scripts/doc-style.py <file> [<file> ...]

Rules enforced here:
  - no em or en dashes, no emoji, no exclamation points
  - max 25 words in a sentence
  - max 4 sentences in a paragraph
  - max 2 paragraphs in a section
  - max 1 code block for each topic (a level 3 heading)

Prose only. The script ignores code blocks, tables, and bullet lists.
"""
import re
import sys
import unicodedata

MAX_WORDS = 25
MAX_SENTENCES = 4
MAX_PARAGRAPHS = 2
MAX_CODE_PER_TOPIC = 1

# Abbreviations that end in a period and do not end a sentence.
ABBREVIATIONS = {"e.g", "i.e", "etc", "vs", "cf", "approx", "Dr", "Mr", "Ms", "No"}

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def is_emoji(char: str) -> bool:
    if char in "‍️":
        return False
    return unicodedata.category(char) == "So" or ord(char) > 0x1F000


def split_sentences(text: str) -> list[str]:
    parts = SENTENCE_END.split(text)
    merged: list[str] = []
    for part in parts:
        if merged:
            tail = merged[-1].rstrip(".").split()[-1] if merged[-1].strip() else ""
            if tail in ABBREVIATIONS:
                merged[-1] = f"{merged[-1]} {part}"
                continue
        merged.append(part)
    return [item.strip() for item in merged if item.strip()]


def check(path: str) -> list[str]:
    problems: list[str] = []
    lines = open(path, encoding="utf-8").read().split("\n")

    in_code = False
    in_list = False
    section = None
    section_line = 0
    topic_line = 0
    paragraphs = 0
    topic = None
    code_blocks = 0
    paragraph: list[str] = []
    paragraph_line = 0

    def flush() -> None:
        nonlocal paragraph, paragraphs
        if not paragraph:
            return
        text = " ".join(paragraph)
        sentences = split_sentences(text)
        if len(sentences) > MAX_SENTENCES:
            problems.append(
                f"{path}:{paragraph_line}: {len(sentences)} sentences, limit {MAX_SENTENCES}"
            )
        for sentence in sentences:
            words = [w for w in re.split(r"\s+", re.sub(r"`[^`]*`", "x", sentence)) if w]
            if len(words) > MAX_WORDS:
                problems.append(
                    f"{path}:{paragraph_line}: {len(words)}-word sentence, limit {MAX_WORDS}"
                    f' -> "{sentence[:60]}..."'
                )
        paragraphs += 1
        paragraph = []

    for number, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            flush()
            in_code = not in_code
            if in_code:
                code_blocks += 1
                if topic and code_blocks > MAX_CODE_PER_TOPIC:
                    problems.append(
                        f"{path}:{number}: code block {code_blocks} under '{topic}',"
                        f" limit {MAX_CODE_PER_TOPIC}"
                    )
            continue
        if in_code:
            continue

        for char in line:
            if char in "—–":
                problems.append(f"{path}:{number}: em or en dash")
                break
        for char in line:
            if is_emoji(char):
                problems.append(f"{path}:{number}: emoji {char!r}")
                break
        if "!" in re.sub(r"`[^`]*`|\[[^\]]*\]\([^)]*\)", "", line):
            problems.append(f"{path}:{number}: exclamation point")

        heading = re.match(r"^(#{1,6})\s+(.*)", line)
        if heading:
            flush()
            level = len(heading.group(1))
            # A level 3 heading is a topic. It gets one paragraph and one code
            # block. A level 2 heading is a major section. Its own prose gets
            # two paragraphs, and the topics below it are counted separately.
            limit = MAX_PARAGRAPHS if topic is None else 1
            owner = topic or section
            owner_line = topic_line if topic else section_line
            if owner and paragraphs > limit:
                problems.append(
                    f"{path}:{owner_line}: '{owner}' has {paragraphs}"
                    f" paragraphs, limit {limit}"
                )
            paragraphs = 0
            if level <= 2:
                section = heading.group(2)
                section_line = number
                topic = None
                code_blocks = 0
            else:
                topic = heading.group(2)
                topic_line = number
                code_blocks = 0
            continue

        stripped = line.strip()
        if not stripped:
            flush()
            in_list = False
            continue
        if stripped.startswith(("-", "*", ">", "|")) or re.match(r"^\d+\.", stripped):
            flush()
            in_list = True
            continue
        # An indented line after a list marker continues that list item. It is
        # not a new paragraph, and counting it as one is how this script used to
        # report phantom violations.
        if in_list and line[:1] in (" ", "\t"):
            continue

        if not paragraph:
            paragraph_line = number
        paragraph.append(stripped)

    flush()
    limit = MAX_PARAGRAPHS if topic is None else 1
    owner = topic or section
    owner_line = topic_line if topic else section_line
    if owner and paragraphs > limit:
        problems.append(
            f"{path}:{owner_line}: '{owner}' has {paragraphs} paragraphs, limit {limit}"
        )
    return problems


def main() -> int:
    found = []
    for path in sys.argv[1:]:
        found.extend(check(path))
    for problem in found:
        print(problem)
    print(f"\n{len(found)} problems")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
