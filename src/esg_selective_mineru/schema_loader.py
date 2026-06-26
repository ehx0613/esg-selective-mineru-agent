from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Dict, List


def load_a_share_schema(original_project_root: Path) -> List[Dict[str, Any]]:
    bundled_schema_path = Path(__file__).resolve().parents[2] / "configs" / "schema" / "a_share_v5.py"
    external_schema_path = original_project_root / "config" / "schema" / "a_share_v5.py"
    schema_path = bundled_schema_path if bundled_schema_path.exists() else external_schema_path
    if not schema_path.exists():
        raise FileNotFoundError(
            f"Cannot find A-share v5 schema: {bundled_schema_path} or {external_schema_path}"
        )
    spec = importlib.util.spec_from_file_location("a_share_v5_external", schema_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import schema module: {schema_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = getattr(module, "A_SHARE_SCHEMA_DATA", None)
    if not isinstance(data, list) or len(data) < 50:
        raise RuntimeError("A_SHARE_SCHEMA_DATA is missing or too small")
    return data


def schema_summary(fields: List[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "total": len(fields),
        "quantitative": sum(1 for item in fields if item.get("indicator_type") == "quantitative"),
        "qualitative": sum(1 for item in fields if item.get("indicator_type") == "qualitative"),
        "hybrid": sum(1 for item in fields if item.get("indicator_type") == "hybrid"),
        "E": sum(1 for item in fields if item.get("category") == "E"),
        "S": sum(1 for item in fields if item.get("category") == "S"),
        "G": sum(1 for item in fields if item.get("category") == "G"),
    }
