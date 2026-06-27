from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

import fitz

_CHUNK_SIZE = 1200
_OVERLAP = 150
_LINE_Y_TOLERANCE = 3.0


def _clean(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text or "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_text(text: str, size: int = _CHUNK_SIZE, overlap: int = _OVERLAP) -> Iterable[str]:
    text = _clean(text)
    if not text:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


def _words_to_visual_lines(words: List[tuple]) -> str:
    rows: List[List[tuple]] = []
    for word in sorted(words, key=lambda item: (round(float(item[1]) / _LINE_Y_TOLERANCE), float(item[0]))):
        y0 = float(word[1])
        for row in rows:
            row_y = sum(float(item[1]) for item in row) / len(row)
            if abs(row_y - y0) <= _LINE_Y_TOLERANCE:
                row.append(word)
                break
        else:
            rows.append([word])

    lines: List[str] = []
    for row in rows:
        ordered = sorted(row, key=lambda item: float(item[0]))
        line = " ".join(str(item[4]) for item in ordered if str(item[4]).strip())
        if line.strip():
            lines.append(line)
    return _clean("\n".join(lines))


def build_pymupdf_layout_chunks(pdf_path: Path) -> List[Dict[str, Any]]:
    doc = fitz.open(pdf_path)
    chunks: List[Dict[str, Any]] = []
    try:
        for page_index, page in enumerate(doc, start=1):
            page_text = _words_to_visual_lines(page.get_text("words") or [])
            for chunk_index, chunk in enumerate(_split_text(page_text), start=1):
                chunks.append({
                    "chunk_id": f"pymupdf_layout_p{page_index}_{chunk_index}",
                    "source": "pymupdf_layout",
                    "page": page_index,
                    "text": chunk,
                })
        return chunks
    finally:
        doc.close()


def build_pymupdf_chunks(pdf_path: Path) -> List[Dict[str, Any]]:
    doc = fitz.open(pdf_path)
    chunks: List[Dict[str, Any]] = []
    try:
        for page_index, page in enumerate(doc, start=1):
            page_text = page.get_text("text") or ""
            for chunk_index, chunk in enumerate(_split_text(page_text), start=1):
                chunks.append({
                    "chunk_id": f"pymupdf_p{page_index}_{chunk_index}",
                    "source": "pymupdf",
                    "page": page_index,
                    "text": chunk,
                })
        return chunks
    finally:
        doc.close()


def build_mineru_chunks(mineru_root: Path) -> List[Dict[str, Any]]:
    if not mineru_root.exists():
        return []
    chunks: List[Dict[str, Any]] = []
    files = list(mineru_root.rglob("*.md")) + list(mineru_root.rglob("*.txt"))
    for file_index, path in enumerate(files, start=1):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for chunk_index, chunk in enumerate(_split_text(text, size=1600, overlap=180), start=1):
            chunks.append({
                "chunk_id": f"mineru_{file_index}_{chunk_index}",
                "source": "mineru",
                "page": None,
                "text": chunk,
                "path": str(path),
            })
    return chunks


def build_rag_chunks(pdf_path: Path, mineru_root: Path | None = None) -> List[Dict[str, Any]]:
    chunks = build_pymupdf_layout_chunks(pdf_path)
    chunks.extend(build_pymupdf_chunks(pdf_path))
    if mineru_root is not None:
        chunks.extend(build_mineru_chunks(mineru_root))
    return chunks
