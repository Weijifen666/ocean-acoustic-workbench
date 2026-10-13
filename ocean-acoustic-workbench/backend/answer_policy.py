"""Explicit retrieval coverage and pretrained-knowledge routing; no training."""
import json
from datetime import datetime, timezone
from pathlib import Path
import uuid

def policy(evidence, scope='course', mode='chat'):
    if scope not in ('course', 'general'):
        raise ValueError('请选择课程依据或模型一般知识')
    covered = bool(evidence)
    template = mode == 'agent'
    status = 'course_evidence' if covered else 'course_template' if template else 'no_course_evidence'
    if covered:
        notice = '本次使用检索到的课程资料；引用不表示已覆盖全部海洋知识。' if scope == 'course' else '课程依据与模型一般知识须分别说明；一般知识未经本项目原文核验。'
    else:
        notice = '本次分析授权项目；未检索到对应课程正文。' if template else '未检索到课程依据。可切换到模型一般知识或补充资料。' if scope == 'course' else '未检索到课程依据；本次使用模型一般知识，未经本项目原文核验。'
    rule = '当前选择【课程依据】，结论只基于检索片段和实际读取的授权项目，依据不足时明确缺口。' if scope == 'course' else '当前选择【模型一般知识】，允许使用模型已有的一般知识回答资料未覆盖的问题；与课程依据分别标注。没有本次提供的资料不得生成课程引用，没有联网工具不得声称已经联网搜索。'
    return {'knowledge_scope': scope, 'coverage_status': status, 'coverage_notice': notice, 'can_generate': scope == 'general' or covered or template, 'rule': rule}

def note_gap(path, question):
    path = Path(path)
    rows = json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    text = question.strip()[:600]
    now = datetime.now(timezone.utc).isoformat()
    existing = next((r for r in rows if r['question'] == text), None)
    if existing:
        existing.update(count=existing['count'] + 1, last_seen=now)
    else:
        rows.insert(0, {'id': str(uuid.uuid4()), 'question': text, 'count': 1, 'created_at': now, 'last_seen': now, 'status': 'pending'})
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(rows[:40], ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)
