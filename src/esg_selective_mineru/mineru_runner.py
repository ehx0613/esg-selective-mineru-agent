from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict

import fitz


def _valid_pages(pdf_path: Path, pages: list[int]) -> list[int]:
    with fitz.open(pdf_path) as source:
        page_count = len(source)
    return sorted({int(page) for page in pages if 1 <= int(page) <= page_count})


def _page_batches(pages: list[int], batch_size: int = 1) -> list[list[int]]:
    valid_batch_size = max(1, batch_size)
    return [pages[index:index + valid_batch_size] for index in range(0, len(pages), valid_batch_size)]


def _create_page_subset_pdf(pdf_path: Path, pages: list[int], output_dir: Path) -> Path:
    source = fitz.open(pdf_path)
    subset = fitz.open()
    try:
        page_count = len(source)
        valid_pages = sorted({int(page) for page in pages if 1 <= int(page) <= page_count})
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


def _run_mineru_command(command: str, timeout_seconds: int) -> Dict[str, Any]:
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
        "status": "completed" if completed.returncode == 0 else "failed",
        "return_code": completed.returncode,
        "stdout_tail": completed.stdout[-2000:],
        "stderr_tail": completed.stderr[-2000:],
    }


def _summarize_batch_results(batch_results: list[Dict[str, Any]]) -> str:
    if not batch_results:
        return "skipped"
    completed = sum(1 for item in batch_results if item.get("status") == "completed")
    if completed == len(batch_results):
        return "completed"
    if completed:
        return "partial"
    return "failed"


def run_mineru(
    pdf_path: Path,
    output_root: Path,
    command_template: str,
    timeout_seconds: int,
    *,
    selected_pages: list[int] | None = None,
    work_dir: Path | None = None,
    batch_size: int = 1,
) -> Dict[str, Any]:
    if not command_template.strip():
        return {"attempted": False, "status": "not_configured", "error": ""}
    output_root.mkdir(parents=True, exist_ok=True)
    valid_pages = _valid_pages(pdf_path, selected_pages or []) if selected_pages else []
    effective_batch_size = max(1, batch_size)
    batches = _page_batches(valid_pages, effective_batch_size) if valid_pages else [[]]
    batch_results: list[Dict[str, Any]] = []
    try:
        for batch_index, batch_pages in enumerate(batches, start=1):
            mineru_pdf_path = pdf_path
            if batch_pages:
                mineru_pdf_path = _create_page_subset_pdf(pdf_path, batch_pages, work_dir or output_root)
            command = command_template.format(pdf=str(mineru_pdf_path.resolve()), output=str(output_root.resolve()))
            result = _run_mineru_command(command, timeout_seconds)
            batch_results.append({
                **result,
                "batch_index": batch_index,
                "command": command,
                "input_pdf": str(mineru_pdf_path),
                "selected_pages": batch_pages,
                "selected_page_count": len(batch_pages),
            })
        return {
            "attempted": True,
            "status": _summarize_batch_results(batch_results),
            "batch_results": batch_results,
            "batch_count": len(batch_results),
            "stdout_tail": "\n".join(str(item.get("stdout_tail") or "") for item in batch_results)[-2000:],
            "stderr_tail": "\n".join(str(item.get("stderr_tail") or "") for item in batch_results)[-2000:],
            "selected_pages": valid_pages,
            "selected_page_count": len(valid_pages),
            "batch_size": effective_batch_size,
        }
    except Exception as exc:
        return {
            "attempted": True,
            "status": "exception",
            "error": str(exc),
            "batch_results": batch_results,
            "batch_count": len(batch_results),
            "selected_pages": valid_pages,
            "selected_page_count": len(valid_pages),
            "batch_size": effective_batch_size,
        }
