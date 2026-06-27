from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .chunks import build_rag_chunks
from .config import Settings
from .io_utils import write_json
from .llm_client import LLMClient
from .quality import enrich_results
from .retriever import HybridRetriever, SimpleRetriever
from .schema_loader import load_a_share_schema, schema_summary

YEAR_RE = re.compile(r"20[0-3][0-9]")
NUMBER_RE = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?")


def _batches(items: List[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    size = max(1, size)
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _empty_result(field: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return {
        "field_key": field.get("field_key"),
        "name_cn": field.get("name_cn"),
        "category": field.get("category"),
        "indicator_type": field.get("indicator_type"),
        "matched": False,
        "value": "",
        "unit": "",
        "year": "",
        "summary": "",
        "evidence": "",
        "source_chunk_id": "",
        "source_page": "",
        "confidence": 0.0,
        "reason": reason,
    }


def _normalize_result(raw: Dict[str, Any], field: Dict[str, Any]) -> Dict[str, Any]:
    result = _empty_result(field, "")
    result.update({key: raw.get(key, result.get(key, "")) for key in result.keys() if key in raw})
    result["field_key"] = field.get("field_key")
    result["name_cn"] = field.get("name_cn")
    result["category"] = field.get("category")
    result["indicator_type"] = field.get("indicator_type")
    result["matched"] = bool(raw.get("matched", False))
    try:
        result["confidence"] = float(raw.get("confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        result["confidence"] = 0.0
    return result


def _number_tokens(text: str) -> List[str]:
    values: List[str] = []
    for match in NUMBER_RE.finditer(text):
        token = match.group(0)
        if YEAR_RE.fullmatch(token.replace(",", "")):
            continue
        values.append(token)
    return values


def _field_terms(field: Dict[str, Any]) -> List[str]:
    terms = [str(field.get("name_cn") or ""), str(field.get("field_key") or "")]
    terms.extend(str(item or "") for item in field.get("aliases") or [])
    return [term.strip().lower() for term in terms if term and len(term.strip()) >= 2]


def _looks_like_field_line(line: str, field: Dict[str, Any], result: Dict[str, Any]) -> bool:
    lowered = line.lower()
    if any(term in lowered for term in _field_terms(field)):
        return True
    evidence = str(result.get("evidence") or "").strip()
    if evidence and evidence in line:
        return True
    unit = str(result.get("unit") or "").strip()
    return bool(unit and unit in line and _number_tokens(line))


def _find_year_aligned_value(
    result: Dict[str, Any],
    field: Dict[str, Any],
    contexts: List[Dict[str, Any]],
    target_year: str,
) -> tuple[str, str]:
    if not target_year or not result.get("matched"):
        return "", ""
    if str(field.get("indicator_type") or "").lower() not in {"quantitative", "定量"}:
        return "", ""

    source_chunk_id = str(result.get("source_chunk_id") or "")
    ordered_contexts = sorted(
        contexts,
        key=lambda item: 0 if source_chunk_id and str(item.get("chunk_id") or "") == source_chunk_id else 1,
    )
    for item in ordered_contexts:
        text = str(item.get("text") or "")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines:
            lines = [text.strip()]
        for index, line in enumerate(lines):
            years = YEAR_RE.findall(line)
            if target_year not in years or len(years) < 2:
                years = []
                for year_line in lines[index:index + 6]:
                    year_values = YEAR_RE.findall(year_line)
                    stripped_year_line = year_line.strip()
                    if (
                        len(year_values) != 1
                        or not stripped_year_line.startswith(year_values[0])
                        or len(stripped_year_line) > 12
                    ):
                        break
                    years.extend(year_values)
                if target_year not in years or len(years) < 2:
                    continue
                search_start = index + len(years)
            else:
                search_start = index + 1
            if len(years) >= 3:
                numeric_years = [int(year) for year in years]
                is_ascending = numeric_years == sorted(numeric_years)
                is_descending = numeric_years == sorted(numeric_years, reverse=True)
                if not is_ascending and not is_descending:
                    years = sorted(years)
            target_index = years.index(target_year)
            for offset, candidate in enumerate(lines[search_start:search_start + 10]):
                if _looks_like_field_line(candidate, field, result):
                    block = lines[search_start + offset:search_start + offset + 8]
                    numbers: List[str] = []
                    for block_line in block:
                        numbers.extend(_number_tokens(block_line))
                        if len(numbers) > target_index:
                            evidence = " ".join([*years, *block])[:160]
                            return numbers[target_index], evidence
    return "", ""


def _align_result_to_target_year(
    result: Dict[str, Any],
    field: Dict[str, Any],
    contexts: Dict[str, List[Dict[str, Any]]],
    target_year: str,
) -> Dict[str, Any]:
    aligned_value, aligned_evidence = _find_year_aligned_value(
        result,
        field,
        contexts.get(str(field.get("field_key") or ""), []),
        target_year,
    )
    if not aligned_value:
        return result
    current_value = str(result.get("value") or "").replace(",", "").strip()
    normalized_aligned = aligned_value.replace(",", "").strip()
    result["year"] = target_year
    if current_value != normalized_aligned:
        result["value"] = normalized_aligned
        result["evidence"] = aligned_evidence
        reason = str(result.get("reason") or "").strip()
        suffix = "year_aligned_from_table"
        result["reason"] = f"{reason}; {suffix}" if reason else suffix
    elif target_year not in str(result.get("evidence") or "") and aligned_evidence:
        result["evidence"] = aligned_evidence
    return result


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "field_key", "name_cn", "category", "indicator_type", "matched", "value", "unit", "year",
        "summary", "evidence", "source_chunk_id", "source_page", "confidence", "reason",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})


def extract_report(pdf_path: Path, output_dir: Path, settings: Settings, *, use_llm: bool = True, target_year: str = "") -> Dict[str, Any]:
    active_year = target_year or settings.target_report_year
    fields = load_a_share_schema(settings.original_esg_project_root)
    mineru_root = settings.mineru_output_root if settings.mineru_output_root.exists() else None
    chunks = build_rag_chunks(pdf_path, mineru_root)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "rag_chunks.json", chunks)

    if settings.retriever_mode == "hybrid":
        retriever = HybridRetriever(
            chunks,
            bm25_top_k=settings.rag_bm25_top_k,
            vector_top_k=settings.rag_vector_top_k,
            rrf_k=settings.rag_rrf_k,
            vector_backend=settings.retriever_vector_backend,
            embedding_api_key=settings.dashscope_api_key,
            embedding_base_url=settings.openai_base_url,
            embedding_model=settings.embedding_model,
            embedding_batch_size=settings.embedding_batch_size,
        )
    else:
        retriever = SimpleRetriever(chunks)
    contexts: Dict[str, List[Dict[str, Any]]] = {}
    for field in fields:
        contexts[field["field_key"]] = retriever.search_field(field, top_k=settings.rag_top_k)
    write_json(output_dir / "field_contexts.json", contexts)

    results: List[Dict[str, Any]] = []
    llm_calls = 0
    llm_errors: List[str] = []
    llm_allowed = use_llm and settings.llm_extraction_enabled
    client = None
    if llm_allowed:
        try:
            client = LLMClient(settings)
        except Exception as exc:
            llm_allowed = False
            llm_errors.append(str(exc))

    if not llm_allowed or client is None:
        results = [_empty_result(field, "llm_disabled_or_not_configured") for field in fields]
    else:
        for batch in _batches(fields, settings.llm_field_batch_size):
            if llm_calls >= settings.llm_max_calls_per_report:
                results.extend(_empty_result(field, "llm_call_budget_exhausted") for field in batch)
                continue
            try:
                raw_results = client.extract_fields(batch, contexts, target_year=active_year)
                by_key = {item.get("field_key"): item for item in raw_results if isinstance(item, dict)}
                for field in batch:
                    result = _normalize_result(by_key.get(field["field_key"], {}), field)
                    results.append(_align_result_to_target_year(result, field, contexts, active_year))
            except Exception as exc:
                llm_errors.append(str(exc))
                results.extend(_empty_result(field, f"llm_error:{exc}") for field in batch)
            llm_calls += 1

    results = enrich_results(results, pdf_path=pdf_path, target_year=active_year)
    summary = {
        "pdf": str(pdf_path),
        "target_year": active_year,
        "schema": schema_summary(fields),
        "chunks": len(chunks),
        "retriever_mode": settings.retriever_mode,
        "retriever_vector_backend": settings.retriever_vector_backend,
        "retriever_vector_backend_actual": getattr(retriever, "vector_backend", ""),
        "embedding_model": settings.embedding_model if settings.retriever_vector_backend == "embedding" else "",
        "fields": len(fields),
        "matched": sum(1 for row in results if row.get("matched")),
        "weak_evidence": sum(1 for row in results if int(row.get("evidence_score") or 0) < 50),
        "quality_warnings": sum(len(row.get("quality_warnings") or []) for row in results),
        "llm_enabled": llm_allowed,
        "llm_model": settings.text_model,
        "llm_calls": llm_calls,
        "llm_errors": llm_errors[:5],
    }
    write_json(output_dir / "extraction_results.json", results)
    write_json(output_dir / "extraction_summary.json", summary)
    write_csv(output_dir / "extraction_results.csv", results)
    return {"summary": summary, "results": results, "contexts": contexts}
