from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class JobStore:
    def __init__(self, db_path: Path, database_url: str = "") -> None:
        self.database_url = database_url
        self.is_postgres = database_url.startswith(("postgresql://", "postgres://"))
        self.db_path = db_path
        if not self.is_postgres:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _connect(self) -> Iterator[Any]:
        conn: Any
        if self.is_postgres:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as exc:
                raise RuntimeError("PostgreSQL requires psycopg[binary]. Run pip install -e . again.") from exc
            conn = psycopg.connect(self.database_url, row_factory=dict_row)
        else:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _ph(self) -> str:
        return "%s" if self.is_postgres else "?"

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.is_postgres else sql

    def _init_schema(self) -> None:
        with self._connect() as conn:
            if not self.is_postgres:
                conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    report_id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    file_sha256 TEXT NOT NULL DEFAULT '',
                    pdf_path TEXT NOT NULL,
                    upload_bytes INTEGER NOT NULL DEFAULT 0,
                    company_name TEXT NOT NULL DEFAULT '',
                    stock_code TEXT NOT NULL DEFAULT '',
                    report_year TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    report_id TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    pdf_path TEXT NOT NULL,
                    output_dir TEXT NOT NULL,
                    use_llm INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT NOT NULL DEFAULT '',
                    summary_json TEXT NOT NULL DEFAULT '{}',
                    upload_bytes INTEGER NOT NULL DEFAULT 0,
                    file_sha256 TEXT NOT NULL DEFAULT '',
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT '',
                    duration_seconds REAL,
                    timing_json TEXT NOT NULL DEFAULT '{}'
                )
            """)
            self._ensure_column(conn, "jobs", "report_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "jobs", "started_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "jobs", "finished_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "jobs", "duration_seconds", "REAL")
            self._ensure_column(conn, "jobs", "timing_json", "TEXT NOT NULL DEFAULT '{}'")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reviews (
                    job_id TEXT NOT NULL,
                    field_key TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    value TEXT,
                    unit TEXT,
                    year TEXT,
                    evidence TEXT,
                    reviewer_note TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (job_id, field_key),
                    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS extraction_results (
                    job_id TEXT NOT NULL,
                    field_key TEXT NOT NULL,
                    name_cn TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT '',
                    indicator_type TEXT NOT NULL DEFAULT '',
                    matched INTEGER NOT NULL DEFAULT 0,
                    value TEXT,
                    unit TEXT,
                    year TEXT,
                    summary TEXT,
                    evidence TEXT,
                    source_chunk_id TEXT,
                    source_page TEXT,
                    confidence REAL NOT NULL DEFAULT 0,
                    normalized_value TEXT,
                    normalized_unit TEXT,
                    quality_warnings_json TEXT NOT NULL DEFAULT '[]',
                    row_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (job_id, field_key),
                    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
                )
            """)
            self._ensure_column(conn, "extraction_results", "report_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "extraction_results", "numeric_value", "REAL")
            if self.is_postgres:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS artifacts (
                        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        job_id TEXT NOT NULL,
                        artifact_type TEXT NOT NULL,
                        path TEXT NOT NULL,
                        mime_type TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        UNIQUE (job_id, artifact_type, path),
                        FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
                    )
                """)
            else:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS artifacts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        job_id TEXT NOT NULL,
                        artifact_type TEXT NOT NULL,
                        path TEXT NOT NULL,
                        mime_type TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        UNIQUE (job_id, artifact_type, path),
                        FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
                    )
                """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_file_sha256 ON reports(file_sha256)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_company_year ON reports(company_name, report_year)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_report_id ON jobs(report_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_file_sha256 ON jobs(file_sha256)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_extraction_results_field_key ON extraction_results(field_key)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_extraction_results_report_id ON extraction_results(report_id)")
            conn.commit()

    @staticmethod
    def _row_get(row: Any, key: str) -> Any:
        return row[key] if isinstance(row, dict) else row[key]

    def _ensure_column(self, conn: Any, table: str, column: str, definition: str) -> None:
        if self.is_postgres:
            rows = conn.execute(
                """
                SELECT column_name AS name
                FROM information_schema.columns
                WHERE table_name = %s
                """,
                (table,),
            ).fetchall()
        else:
            rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        columns = {self._row_get(row, "name") for row in rows}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @staticmethod
    def _row_to_job(row: Any) -> dict[str, Any]:
        job = dict(row)
        job["use_llm"] = bool(job.get("use_llm"))
        job["summary"] = json.loads(str(job.pop("summary_json") or "{}"))
        job["timing"] = json.loads(str(job.pop("timing_json") or "{}"))
        for key in ("report_id", "report_filename", "company_name", "stock_code", "report_year"):
            job[key] = "" if job.get(key) is None else str(job.get(key) or "")
        if job.get("duration_seconds") is None:
            summary_timing = job.get("summary", {}).get("timing", {})
            if isinstance(summary_timing, dict) and summary_timing.get("total_seconds") is not None:
                job["duration_seconds"] = float(summary_timing.get("total_seconds") or 0)
        return job

    @staticmethod
    def _numeric_value(value: Any) -> float | None:
        text = str(value or "").strip().replace(",", "")
        if not text:
            return None
        import re
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        return float(match.group(0)) if match else None

    def upsert_report(self, report: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                self._sql(
                """
                INSERT INTO reports (
                    report_id, filename, file_sha256, pdf_path, upload_bytes,
                    company_name, stock_code, report_year, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(report_id) DO UPDATE SET
                    filename=excluded.filename,
                    file_sha256=excluded.file_sha256,
                    pdf_path=excluded.pdf_path,
                    upload_bytes=excluded.upload_bytes,
                    company_name=excluded.company_name,
                    stock_code=excluded.stock_code,
                    report_year=excluded.report_year,
                    updated_at=excluded.updated_at
                """,
                ),
                (
                    report["report_id"],
                    report.get("filename", ""),
                    report.get("file_sha256", ""),
                    report.get("pdf_path", ""),
                    int(report.get("upload_bytes") or 0),
                    report.get("company_name", ""),
                    report.get("stock_code", ""),
                    report.get("report_year", ""),
                    report.get("created_at", ""),
                    report.get("updated_at", report.get("created_at", "")),
                ),
            )
            conn.commit()

    def upsert_job(self, job: dict[str, Any]) -> None:
        summary_json = json.dumps(job.get("summary") or {}, ensure_ascii=False)
        timing_json = json.dumps(job.get("timing") or (job.get("summary") or {}).get("timing") or {}, ensure_ascii=False)
        report_id = str(job.get("report_id") or job.get("file_sha256") or job["job_id"])
        with self._connect() as conn:
            conn.execute(
                self._sql(
                """
                INSERT INTO jobs (
                    job_id, report_id, status, mode, pdf_path, output_dir, use_llm,
                    created_at, updated_at, error, summary_json,
                    upload_bytes, file_sha256, retry_count,
                    started_at, finished_at, duration_seconds, timing_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    report_id=excluded.report_id,
                    status=excluded.status,
                    mode=excluded.mode,
                    pdf_path=excluded.pdf_path,
                    output_dir=excluded.output_dir,
                    use_llm=excluded.use_llm,
                    updated_at=excluded.updated_at,
                    error=excluded.error,
                    summary_json=excluded.summary_json,
                    upload_bytes=excluded.upload_bytes,
                    file_sha256=excluded.file_sha256,
                    retry_count=excluded.retry_count,
                    started_at=excluded.started_at,
                    finished_at=excluded.finished_at,
                    duration_seconds=excluded.duration_seconds,
                    timing_json=excluded.timing_json
                """,
                ),
                (
                    job["job_id"],
                    report_id,
                    job["status"],
                    job["mode"],
                    job["pdf_path"],
                    job["output_dir"],
                    1 if job.get("use_llm", True) else 0,
                    job["created_at"],
                    job["updated_at"],
                    job.get("error", ""),
                    summary_json,
                    int(job.get("upload_bytes") or 0),
                    job.get("file_sha256", ""),
                    int(job.get("retry_count") or 0),
                    job.get("started_at", ""),
                    job.get("finished_at", ""),
                    job.get("duration_seconds"),
                    timing_json,
                ),
            )
            conn.commit()

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(f"""
                SELECT
                    j.*,
                    r.filename AS report_filename,
                    r.company_name,
                    r.stock_code,
                    r.report_year
                FROM jobs j
                LEFT JOIN reports r ON r.report_id = j.report_id
                WHERE j.job_id = {self._ph()}
            """, (job_id,)).fetchone()
        return self._row_to_job(row) if row else None

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT
                    j.*,
                    r.filename AS report_filename,
                    r.company_name,
                    r.stock_code,
                    r.report_year
                FROM jobs j
                LEFT JOIN reports r ON r.report_id = j.report_id
                ORDER BY j.updated_at DESC
            """).fetchall()
        return [self._row_to_job(row) for row in rows]

    def update_report_metadata(
        self,
        report_id: str,
        *,
        company_name: str = "",
        stock_code: str = "",
        report_year: str = "",
        updated_at: str,
    ) -> dict[str, Any] | None:
        with self._connect() as conn:
            conn.execute(
                self._sql(
                    """
                    UPDATE reports
                    SET company_name = ?, stock_code = ?, report_year = ?, updated_at = ?
                    WHERE report_id = ?
                    """
                ),
                (company_name, stock_code, report_year, updated_at, report_id),
            )
            conn.commit()
            row = conn.execute(
                f"""
                SELECT report_id, filename, company_name, stock_code, report_year, updated_at
                FROM reports
                WHERE report_id = {self._ph()}
                """,
                (report_id,),
            ).fetchone()
        return dict(row) if row else None

    def delete_job(self, job_id: str) -> None:
        with self._connect() as conn:
            ph = self._ph()
            conn.execute(f"DELETE FROM artifacts WHERE job_id = {ph}", (job_id,))
            conn.execute(f"DELETE FROM extraction_results WHERE job_id = {ph}", (job_id,))
            conn.execute(f"DELETE FROM reviews WHERE job_id = {ph}", (job_id,))
            conn.execute(f"DELETE FROM jobs WHERE job_id = {ph}", (job_id,))
            conn.commit()

    def read_reviews(self, job_id: str) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM reviews WHERE job_id = {self._ph()}", (job_id,)).fetchall()
        return {str(row["field_key"]): dict(row) for row in rows}

    def write_review(self, job_id: str, field_key: str, record: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                self._sql(
                """
                INSERT INTO reviews (
                    job_id, field_key, status, value, unit, year,
                    evidence, reviewer_note, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id, field_key) DO UPDATE SET
                    status=excluded.status,
                    value=excluded.value,
                    unit=excluded.unit,
                    year=excluded.year,
                    evidence=excluded.evidence,
                    reviewer_note=excluded.reviewer_note,
                    updated_at=excluded.updated_at
                """,
                ),
                (
                    job_id,
                    field_key,
                    record.get("status", "pending"),
                    record.get("value"),
                    record.get("unit"),
                    record.get("year"),
                    record.get("evidence"),
                    record.get("reviewer_note", ""),
                    record["updated_at"],
                ),
            )
            conn.commit()

    def upsert_extraction_results(
        self,
        job_id: str,
        rows: list[dict[str, Any]],
        updated_at: str,
        report_id: str = "",
    ) -> None:
        with self._connect() as conn:
            for row in rows:
                field_key = str(row.get("field_key") or "")
                if not field_key:
                    continue
                conn.execute(
                    self._sql(
                    """
                    INSERT INTO extraction_results (
                        job_id, report_id, field_key, name_cn, category, indicator_type, matched,
                        value, unit, year, summary, evidence, source_chunk_id, source_page,
                        confidence, normalized_value, normalized_unit, numeric_value,
                        quality_warnings_json, row_json, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(job_id, field_key) DO UPDATE SET
                        report_id=excluded.report_id,
                        name_cn=excluded.name_cn,
                        category=excluded.category,
                        indicator_type=excluded.indicator_type,
                        matched=excluded.matched,
                        value=excluded.value,
                        unit=excluded.unit,
                        year=excluded.year,
                        summary=excluded.summary,
                        evidence=excluded.evidence,
                        source_chunk_id=excluded.source_chunk_id,
                        source_page=excluded.source_page,
                        confidence=excluded.confidence,
                        normalized_value=excluded.normalized_value,
                        normalized_unit=excluded.normalized_unit,
                        numeric_value=excluded.numeric_value,
                        quality_warnings_json=excluded.quality_warnings_json,
                        row_json=excluded.row_json,
                        updated_at=excluded.updated_at
                    """,
                    ),
                    (
                        job_id,
                        report_id,
                        field_key,
                        str(row.get("name_cn") or ""),
                        str(row.get("category") or ""),
                        str(row.get("indicator_type") or ""),
                        1 if row.get("matched") else 0,
                        row.get("value"),
                        row.get("unit"),
                        row.get("year"),
                        row.get("summary"),
                        row.get("evidence"),
                        row.get("source_chunk_id"),
                        str(row.get("source_page") or ""),
                        float(row.get("confidence") or 0),
                        row.get("normalized_value"),
                        row.get("normalized_unit"),
                        self._numeric_value(row.get("normalized_value") or row.get("value")),
                        json.dumps(row.get("quality_warnings") or [], ensure_ascii=False),
                        json.dumps(row, ensure_ascii=False),
                        updated_at,
                    ),
                )
            conn.commit()

    def read_extraction_results(self, job_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT row_json FROM extraction_results WHERE job_id = {self._ph()} ORDER BY updated_at, field_key",
                (job_id,),
            ).fetchall()
        return [json.loads(str(row["row_json"])) for row in rows]

    def add_artifact(self, job_id: str, artifact_type: str, path: str, mime_type: str, created_at: str) -> None:
        with self._connect() as conn:
            insert_sql = """
                INSERT INTO artifacts (job_id, artifact_type, path, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (job_id, artifact_type, path) DO NOTHING
            """ if self.is_postgres else """
                INSERT OR IGNORE INTO artifacts (job_id, artifact_type, path, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?)
            """
            conn.execute(
                self._sql(insert_sql),
                (job_id, artifact_type, path, mime_type, created_at),
            )
            conn.commit()

    def list_artifacts(self, job_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT id, job_id, artifact_type, path, mime_type, created_at FROM artifacts WHERE job_id = {self._ph()} ORDER BY id",
                (job_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def metric_options(self) -> dict[str, list[dict[str, Any]]]:
        with self._connect() as conn:
            years = conn.execute("""
                SELECT DISTINCT COALESCE(NULLIF(r.report_year, ''), NULLIF(e.year, '')) AS year
                FROM extraction_results e
                JOIN jobs j ON j.job_id = e.job_id
                LEFT JOIN reports r ON r.report_id = j.report_id
                WHERE COALESCE(NULLIF(r.report_year, ''), NULLIF(e.year, '')) IS NOT NULL
                ORDER BY year DESC
            """).fetchall()
            companies = conn.execute("""
                SELECT DISTINCT
                    COALESCE(NULLIF(r.company_name, ''), r.filename, j.job_id) AS company_name,
                    r.stock_code,
                    j.report_id
                FROM jobs j
                LEFT JOIN reports r ON r.report_id = j.report_id
                WHERE j.status = 'succeeded'
                ORDER BY company_name
            """).fetchall()
            metrics = conn.execute("""
                SELECT field_key, MAX(name_cn) AS name_cn, MAX(category) AS category, MAX(indicator_type) AS indicator_type
                FROM extraction_results
                WHERE matched = 1
                GROUP BY field_key
                ORDER BY category, name_cn, field_key
            """).fetchall()
        return {
            "years": [dict(row) for row in years if dict(row).get("year")],
            "companies": [dict(row) for row in companies],
            "metrics": [dict(row) for row in metrics],
        }

    def compare_metrics(
        self,
        *,
        year: str = "",
        field_key: str = "",
        report_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        filters = ["j.status = 'succeeded'", "e.matched = 1", "COALESCE(rv.status, 'pending') <> 'rejected'"]
        params: list[Any] = []
        ph = self._ph()
        if year:
            filters.append(f"COALESCE(NULLIF(r.report_year, ''), NULLIF(e.year, '')) = {ph}")
            params.append(year)
        if field_key:
            filters.append(f"e.field_key = {ph}")
            params.append(field_key)
        if report_ids:
            placeholders = ", ".join([ph] * len(report_ids))
            filters.append(f"j.report_id IN ({placeholders})")
            params.extend(report_ids)
        where = " AND ".join(filters)
        with self._connect() as conn:
            rows = conn.execute(f"""
                SELECT
                    j.job_id,
                    j.report_id,
                    COALESCE(NULLIF(r.company_name, ''), r.filename, j.job_id) AS company_name,
                    r.stock_code,
                    COALESCE(NULLIF(r.report_year, ''), NULLIF(e.year, '')) AS report_year,
                    e.field_key,
                    e.name_cn,
                    e.category,
                    e.indicator_type,
                    COALESCE(NULLIF(rv.value, ''), e.value) AS value,
                    e.numeric_value,
                    COALESCE(NULLIF(rv.unit, ''), e.unit) AS unit,
                    COALESCE(NULLIF(rv.value, ''), e.normalized_value) AS normalized_value,
                    COALESCE(NULLIF(rv.unit, ''), e.normalized_unit) AS normalized_unit,
                    COALESCE(NULLIF(rv.year, ''), e.year) AS data_year,
                    COALESCE(NULLIF(rv.evidence, ''), e.evidence) AS evidence,
                    e.source_page,
                    e.confidence
                FROM extraction_results e
                JOIN jobs j ON j.job_id = e.job_id
                LEFT JOIN reports r ON r.report_id = j.report_id
                LEFT JOIN reviews rv ON rv.job_id = e.job_id AND rv.field_key = e.field_key
                WHERE {where}
                ORDER BY company_name, report_year
            """, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def trend_metrics(self, *, report_id: str = "", company_name: str = "", field_key: str = "") -> list[dict[str, Any]]:
        filters = ["j.status = 'succeeded'", "e.matched = 1", "COALESCE(rv.status, 'pending') <> 'rejected'"]
        params: list[Any] = []
        ph = self._ph()
        if report_id:
            filters.append(f"j.report_id = {ph}")
            params.append(report_id)
        if company_name:
            filters.append(f"COALESCE(NULLIF(r.company_name, ''), r.filename, j.job_id) = {ph}")
            params.append(company_name)
        if field_key:
            filters.append(f"e.field_key = {ph}")
            params.append(field_key)
        where = " AND ".join(filters)
        with self._connect() as conn:
            rows = conn.execute(f"""
                SELECT
                    j.job_id,
                    j.report_id,
                    COALESCE(NULLIF(r.company_name, ''), r.filename, j.job_id) AS company_name,
                    COALESCE(NULLIF(r.report_year, ''), NULLIF(e.year, '')) AS report_year,
                    e.field_key,
                    e.name_cn,
                    e.category,
                    COALESCE(NULLIF(rv.value, ''), e.value) AS value,
                    e.numeric_value,
                    COALESCE(NULLIF(rv.unit, ''), e.unit) AS unit,
                    COALESCE(NULLIF(rv.value, ''), e.normalized_value) AS normalized_value,
                    COALESCE(NULLIF(rv.unit, ''), e.normalized_unit) AS normalized_unit,
                    COALESCE(NULLIF(rv.year, ''), e.year) AS data_year,
                    COALESCE(NULLIF(rv.evidence, ''), e.evidence) AS evidence,
                    e.source_page,
                    e.confidence
                FROM extraction_results e
                JOIN jobs j ON j.job_id = e.job_id
                LEFT JOIN reports r ON r.report_id = j.report_id
                LEFT JOIN reviews rv ON rv.job_id = e.job_id AND rv.field_key = e.field_key
                WHERE {where}
                ORDER BY report_year, company_name
            """, tuple(params)).fetchall()
        return [dict(row) for row in rows]
