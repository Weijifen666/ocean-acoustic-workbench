"""Bounded provider views; original tool results stay in private protocol storage."""
import copy
import json
import context_budget


def file_directory(result, args):
    offset, limit = args.get('offset', 0), args.get('limit', 20)
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError('文件目录分页要求非负offset和1–50的limit')
    files = result.get('files', [])
    return {**{k: v for k, v in result.items() if k != 'files'}, 'files': files[offset:offset+limit],
            'offset': offset, 'total': len(files), 'next_offset': offset+limit if offset+limit < len(files) else None,
            'note': '这是明确分页的文件目录；按next_offset继续，不表示目录只有本页文件。'}


def file_page(result, args):
    if result.get('kind') != 'text':
        return result
    offset, maximum = args.get('offset', 0), args.get('max_bytes', 12000)
    text = result.get('content', '')
    if type(offset) is not int or offset < 0 or offset > len(text) or type(maximum) is not int or not 256 <= maximum <= 20000:
        raise ValueError('文本分页要求有效字符offset和256–20000的max_bytes')
    end, size = offset, 0
    while end < len(text):
        count = len(text[end].encode('utf-8'))
        if size+count > maximum:
            break
        end += 1; size += count
    return {**result, 'content': text[offset:end], 'offset': offset, 'returned_bytes': size,
            'next_offset': end if end < len(text) else None, 'total_available_characters': len(text),
            'has_more': end < len(text), 'complete': offset == 0 and end == len(text) and not result.get('truncated'),
            'source_truncated': bool(result.get('truncated')), 'truncated': offset > 0 or end < len(text) or bool(result.get('truncated')),
            'sha256_scope': 'first_200000_bytes' if result.get('truncated') else 'complete_file',
            'note': '字符offset与UTF-8字节预算分页；片段不是完整文件。底层最多读取200000字节，source_truncated为真时其余内容须下载原文件核对。'}


def project_result(value):
    if isinstance(value, list):
        return [project_result(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in ('tl_db', 'pressure', 'pressure_real', 'pressure_imag', 'mode_shapes', 'eigenfunctions', 'rays', 'modes') and isinstance(item, list):
            result[key+'_index'] = {'omitted': True, 'length': len(item), 'note': '完整数值位于实际任务产物；此处不据摘要编造数值。'}
        elif key in ('stdout', 'stderr', 'log') and isinstance(item, str) and len(item.encode('utf-8')) > 6000:
            result[key] = item[-1500:]; result[key+'_truncated'] = True
        else:
            result[key] = project_result(item)
    return result


def prepare(messages, tools, budget='auto', *, current_user_index, history_turn_lengths=()):
    """Keep system/current question/latest tool group; drop complete older units."""
    raw = copy.deepcopy(messages)
    resolved = context_budget.resolve_budget(budget)
    limit = float('inf') if resolved is None else resolved-context_budget.CONTEXT_RESERVE
    metadata = {'requested_budget': budget, 'compacted_tool_messages': 0, 'dropped_tool_messages': 0,
                'dropped_history_messages': 0, 'dropped_evidence_count': 0, 'notes': []}
    for message in raw:
        if message.get('role') != 'tool':
            continue
        try:
            old = json.loads(message['content']); projected = project_result(old)
            # Formatting whitespace is not evidence. Normalize every JSON tool
            # view, including complete Skill/file pages, without changing its
            # values or the original protocol retained in private storage.
            message['content'] = json.dumps(projected, ensure_ascii=False, separators=(',', ':'))
            if projected != old: metadata['compacted_tool_messages'] += 1
        except (ValueError, TypeError):
            pass
    system = raw[:1]
    history = []; start = 1
    for length in history_turn_lengths:
        history.append(raw[start:start+length]); start += length
    if start != current_user_index:
        raise context_budget.ContextBudgetError('研究历史边界不完整，请新建会话并核对已有任务。')
    question = [raw[current_user_index]]
    groups = []; index = current_user_index+1
    while index < len(raw):
        message = raw[index]; group = [message]; index += 1
        if message.get('role') == 'assistant' and message.get('tool_calls'):
            expected = {call['id'] for call in message['tool_calls']}
            while index < len(raw) and raw[index].get('role') == 'tool':
                tool = raw[index]
                if tool.get('tool_call_id') not in expected:
                    raise context_budget.ContextBudgetError('工具调用与结果标识不匹配。')
                expected.remove(tool['tool_call_id']); group.append(tool); index += 1
            if expected:
                raise context_budget.ContextBudgetError('最新工具轮尚不完整，不能发送孤立调用。')
        groups.append(group)
    def assemble():
        return system+[entry for group in history for entry in group]+question+[entry for group in groups for entry in group]
    def over():
        return context_budget.estimate_messages(assemble(), tools) > limit
    while over() and history:
        metadata['dropped_history_messages'] += len(history.pop(0))
    removed = []
    while over():
        last_tool = max((i for i, group in enumerate(groups) if any(m.get('role') == 'tool' for m in group)), default=0)
        if last_tool <= 0:
            break
        group = groups.pop(0); removed.extend(group)
        metadata['dropped_tool_messages'] += sum(m.get('role') == 'tool' for m in group)
    label = context_budget.CONTEXT_LABEL
    position = system[0]['content'].find(label)
    if over() and position >= 0:
        try:
            data = json.loads(system[0]['content'][position+len(label):])
            while data.get('evidence') and over():
                data['evidence'].pop(); metadata['dropped_evidence_count'] += 1
                system[0]['content'] = system[0]['content'][:position]+label+json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        except (ValueError, TypeError):
            pass
    if removed:
        locators = []
        for message in removed:
            if message.get('role') != 'tool':
                continue
            try:
                result = json.loads(message['content'])
                if isinstance(result, dict):
                    locator = {k: result[k] for k in ('id', 'ids', 'state', 'path', 'skill', 'sha256', 'next_offset') if k in result}
                    if locator: locators.append(locator)
            except (ValueError, TypeError):
                pass
        if locators:
            system[0]['content'] += '\n先前工具定位索引（仅供重新读取，不是新计算或已验证结论）：'+json.dumps(locators[-30:], ensure_ascii=False)
    packed = assemble(); count = context_budget.estimate_messages(packed, tools)
    metadata['estimated_input_tokens'] = count
    if metadata['compacted_tool_messages']: metadata['notes'].append('发送视图省略大数值矩阵/长日志，原协议记录不改写；完整数值从实际产物核对。')
    if metadata['dropped_tool_messages']: metadata['notes'].append('较早工具轮整组省略，保留定位索引和最新完整工具结果。')
    if metadata['dropped_history_messages']: metadata['notes'].append('较早用户轮整组省略，当前原问题保留。')
    if metadata['dropped_evidence_count']: metadata['notes'].append('初始检索中较低优先级证据已省略，未截断当前问题或工具定义。')
    if count > limit:
        error = context_budget.ContextBudgetError('当前必要问题、工具定义或最新完整工具结果超过上下文预算；请分页读取、缩小范围或提高预算，已有任务没有重算。')
        error.context = metadata
        raise error
    return {'messages': packed, 'context': metadata}
