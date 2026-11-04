"""Export authorized course excerpts to a private, versioned cloud upload bundle.

Only chunks.payload and metadata.report are read from the source SQLite file.
No source files, configuration, credentials, search_text or filesystem paths
are copied. The exporter does not upload or modify the source database.
"""
import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import tempfile
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

MAX_ROWS = 12000
MAX_TEXT = 4000
MAX_RAW = 16 * 1024 * 1024
MAX_PACKED = 6 * 1024 * 1024
ROW_FIELDS = (
    'id', 'source_id', 'pdf_page', 'label', 'text', 'source_revision',
    'ingestion_version', 'node_id', 'node_ids', 'printed_page', 'char_start',
    'char_end', 'offset_basis', 'conditions', 'formula', 'text_policy',
    'math_layout_verified', 'evidence_type', 'verification_status',
)
COUNT_FIELDS = (
    'total_pages', 'selected_pages', 'processed_pages', 'processed_units',
    'indexed_units', 'failed_or_needs_ocr_pages', 'blank_or_short_pages',
    'unreadable_pages',
)


def integer(value, minimum=0, maximum=1000000):
    return type(value) is int and minimum <= value <= maximum


def safe_label(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Missing source label.')
    label = value.replace('\\', '/').rsplit('/', 1)[-1].strip()
    if not label or len(label) > 400:
        raise ValueError('Invalid source label.')
    return label


def project_chunk(payload, database_id, source_id, pdf_page):
    if not isinstance(payload, dict):
        raise ValueError('Invalid chunk payload.')
    row = {key: payload[key] for key in ROW_FIELDS if key in payload}
    if row.get('id') != database_id or row.get('source_id') != source_id or row.get('pdf_page') != pdf_page:
        raise ValueError('Chunk identity differs from database columns.')
    if not re.fullmatch(r'S\d{2,4}', source_id or '') or not re.fullmatch(r'D-' + source_id + r'-[A-Za-z0-9_-]{1,100}', database_id or ''):
        raise ValueError('Invalid source or chunk identifier.')
    text = row.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ValueError('Chunk text is empty or exceeds the character limit.')
    if not re.fullmatch(r'[a-f0-9]{64}', row.get('source_revision') or ''):
        raise ValueError('Invalid source revision.')
    if not integer(row.get('ingestion_version'), 2, 100):
        raise ValueError('Rebuild legacy text ingestion before exporting.')
    if pdf_page is not None and not integer(pdf_page, 1, 100000):
        raise ValueError('Invalid PDF page.')
    if not integer(row.get('char_start'), 0, 10000000) or not integer(row.get('char_end'), row['char_start'], 10000000):
        raise ValueError('Invalid text offsets.')
    nodes = row.get('node_ids', [])
    if not isinstance(nodes, list) or len(nodes) > 32 or any(not isinstance(node, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,99}', node) for node in nodes) or len(set(nodes)) != len(nodes):
        raise ValueError('Invalid knowledge node identifiers.')
    if row.get('node_id') is not None and row['node_id'] not in nodes:
        raise ValueError('Primary knowledge node is not in the node list.')
    row.update(label=safe_label(row.get('label')), node_ids=nodes, node_id=row.get('node_id'),
               evidence_type='source_excerpt', verification_status='source_text_unreviewed',
               math_layout_verified=False, text_policy='unicode_display_preserved_search_nfkc_v2',
               offset_basis='display_page_text_v2')
    for key in ('conditions', 'formula'):
        value = row.get(key, '')
        if key == 'conditions' and value == '以下为原文片段；适用条件、单位及公式需结合原页和人工核查，不能据此补造结论。':
            value = '教材原文片段'
        if not isinstance(value, str) or len(value) > 4000 or re.match(r'^[A-Za-z]:[\\/]|^\\\\|^/|file://', value, re.I):
            raise ValueError('Invalid chunk metadata.')
        row[key] = value
    return row


def export_course_knowledge(database, output, version):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', version or ''):
        raise ValueError('Version must use 1-80 lowercase letters, digits and hyphens.')
    database, output = Path(database).resolve(), Path(output).resolve()
    if not database.is_file():
        raise ValueError('Source database is not a file.')
    if output == database.parent or output == database:
        raise ValueError('Use a separate private export directory.')
    if (output / 'chunks.json.gz').exists() or (output / 'manifest.json').exists():
        raise ValueError('Export destination already contains a bundle; choose a new directory.')
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
        count = connection.execute('SELECT COUNT(*) FROM chunks').fetchone()[0]
        if not 1 <= count <= MAX_ROWS:
            raise ValueError('Source chunk count exceeds the supported range.')
        rows = [project_chunk(json.loads(payload), chunk_id, source, page)
                for chunk_id, source, page, payload in connection.execute('SELECT id,source_id,pdf_page,payload FROM chunks ORDER BY source_id,pdf_page,id')]
        report_row = connection.execute("SELECT value FROM metadata WHERE key='report'").fetchone()
        report = json.loads(report_row[0]) if report_row else {}
    versions = {row['ingestion_version'] for row in rows}
    if len(versions) != 1:
        raise ValueError('Mixed ingestion versions require a clean rebuild.')
    grouped = defaultdict(list)
    for row in rows:
        grouped[row['source_id']].append(row)
    reported = {item['source_id']: item for item in report.get('source_coverage', [])
                if isinstance(item, dict) and isinstance(item.get('source_id'), str)}
    coverage = []
    for source_id, values in sorted(grouped.items()):
        revisions = {row['source_revision'] for row in values}
        if len(revisions) != 1:
            raise ValueError('A source contains mixed revisions.')
        original = reported.get(source_id, {})
        item = {'source_id': source_id, 'title': safe_label(original.get('title') or values[0]['label']),
                'source_revision': values[0]['source_revision'], 'chunks': len(values),
                'indexed_pages': len({row['pdf_page'] for row in values if row['pdf_page'] is not None})}
        for key in COUNT_FIELDS:
            value = original.get(key)
            if value is None or integer(value):
                item[key] = value
        for key in ('coverage_ratio', 'selected_success_ratio'):
            value = original.get(key)
            if value is None or type(value) in (int, float) and 0 <= value <= 1:
                item[key] = value
        if type(original.get('full_document_selected')) is bool:
            item['full_document_selected'] = original['full_document_selected']
        if original.get('type') in ('.pdf', '.docx', '.pptx', '.txt', '.md'):
            item['type'] = original['type']
        coverage.append(item)
    payload = {'schema_version': 1, 'version': version, 'chunks': rows}
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(raw) > MAX_RAW:
        raise ValueError('Uncompressed bundle exceeds 16 MiB.')
    packed = gzip.compress(raw, mtime=0)
    if len(packed) > MAX_PACKED:
        raise ValueError('Compressed bundle exceeds 6 MiB.')
    manifest = {'schema_version': 1, 'version': version, 'chunks_key': 'chunks.json.gz',
                'chunks_sha256': hashlib.sha256(packed).hexdigest(),
                'compressed_bytes': len(packed), 'uncompressed_bytes': len(raw),
                'chunks': len(rows), 'indexed_sources': len(grouped),
                'indexed_pages': sum(item['indexed_pages'] for item in coverage),
                'source_coverage': coverage, 'ingestion_version': versions.pop(),
                'created_at': datetime.now(timezone.utc).isoformat(),
                'text_policy': 'unicode_display_preserved_search_nfkc_v2',
                'math_layout_verified': False}
    output.mkdir(parents=True, exist_ok=True)
    # The export is private even if a caller selects a non-.local directory.
    (output / '.gitignore').write_text('*\n', encoding='utf-8')
    for name, content in [('chunks.json.gz', packed), ('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))]:
        with tempfile.NamedTemporaryFile(dir=output, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
        try:
            temporary.replace(output / name)
        finally:
            temporary.unlink(missing_ok=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    try:
        manifest = export_course_knowledge(args.database, args.output, args.version)
    except (ValueError, sqlite3.Error, OSError, json.JSONDecodeError) as error:
        # Do not echo private database paths or raw SQL/payload values.
        message = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else type(error).__name__
        parser.exit(1, 'Export failed: ' + message + '\n')
    print(json.dumps({key: manifest[key] for key in ('version', 'chunks', 'indexed_sources', 'indexed_pages', 'compressed_bytes', 'uncompressed_bytes', 'chunks_sha256')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
