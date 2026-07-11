import csv
import os
from datetime import datetime
from pathlib import Path

import psycopg


BASE_DIR = Path(__file__).resolve().parents[1]
CSV_PATH = Path(os.getenv("VISITOR_CSV_PATH", BASE_DIR / "visitor_history_log.csv"))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


def normalize_database_url(url):
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def main():
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL is required")
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV file not found: {CSV_PATH}")

    rows = []
    with CSV_PATH.open("r", encoding="utf-8") as file:
        reader = csv.reader(file)
        next(reader, None)
        for row in reader:
            if len(row) < 3:
                continue
            try:
                rows.append(
                    (
                        datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S"),
                        row[1],
                        int(row[2]),
                    )
                )
            except Exception:
                continue

    with psycopg.connect(normalize_database_url(DATABASE_URL)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS visitor_counts (
                    id BIGSERIAL PRIMARY KEY,
                    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    zone_id TEXT NOT NULL,
                    zone_name TEXT,
                    people_count INTEGER NOT NULL,
                    limit_count INTEGER,
                    density TEXT,
                    online BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.executemany(
                """
                INSERT INTO visitor_counts (recorded_at, zone_id, people_count)
                VALUES (%s, %s, %s)
                """,
                rows,
            )
        conn.commit()

    print(f"Migrated {len(rows)} rows from {CSV_PATH} to visitor_counts")


if __name__ == "__main__":
    main()
