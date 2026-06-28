from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict

import fitz


def _create_page_subset_pdf(pdf_path: Path, pages: list[int], output_dir: Path) -> Path:
    source = fitz.open(pdf_path)
    subset = fitz.open()
    try:
        page_count = len(source)
        valid_pages = sorted({page for page in pages if 1 <= int(page) <= page_count})
        if not valid_pages:
            return pdf_path
        for page_number in valid_pages:
            source_index = page_number - 1
            subset.insert_pdf(source, from_page=source_index, to_page=source_index)
        output_dir.mkdir(parents=True, exist_ok=True)
        subset_path = output_dir / f"{pdf_path.stem}.mineru_pages_{valid_pages[0]}_{valid_pages[-1]}.pdf"
        subset.save(subset_path)
        return subset_path
    finally:
        subset.close()
        source.close()


def run_mineru(
    pdf_path: Path,
    output_root: Path,
    command_template: str,
    timeout_seconds: int,
    *,
    selected_pages: list[int] | None = None,
    work_dir: Path | None = None,
) -> Dict[str, Any]:
    if not command_template.strip():
        return {"attempted": False, "status": "not_configured", "error": ""}
    output_root.mkdir(parents=True, exist_ok=True)
    mineru_pdf_path = pdf_path
    if selected_pages:
        mineru_pdf_path = _create_page_subset_pdf(pdf_path, selected_pages, work_dir or output_root)
    command = command_template.format(pdf=str(mineru_pdf_path.resolve()), output=str(output_root.resolve()))
    try:
        completed = subprocess.run(
            shlex.split(command, posix=os.name != "nt"),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            check=False,
        )
        return {
            "attempted": True,
            "status": "completed" if completed.returncode == 0 else "failed",
            "return_code": completed.returncode,
            "stdout_tail": completed.stdout[-2000:],
            "stderr_tail": completed.stderr[-2000:],
            "command": command,
            "input_pdf": str(mineru_pdf_path),
            "selected_pages": selected_pages or [],
            "selected_page_count": len(selected_pages or []),
        }
    except Exception as exc:
        return {
            "attempted": True,
            "status": "exception",
            "error": str(exc),
            "command": command,
            "input_pdf": str(mineru_pdf_path),
            "selected_pages": selected_pages or [],
            "selected_page_count": len(selected_pages or []),
        }
