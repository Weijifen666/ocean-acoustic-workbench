"""Read-only graph operations; explicit selections never live in shared state."""
from copy import deepcopy
import unicodedata

GROUPS = ['hierarchy', 'prerequisite', 'related']
NOTE = '父子关系表示课程层级，建议先学表示教学顺序，概念关联不等于物理因果或证明。'
FIELDS = ['id', 'label', 'kind', 'chapter', 'overview', 'key_points', 'formula', 'conditions', 'misconception', 'tags', 'references', 'images', 'source_claim_ids']
ALIASES = {'normal modes':'简正波', 'normal mode':'简正波', 'sound speed profile':'声速剖面', 'transmission loss':'传播损失', 'wavenumber integration':'波数积分', 'parabolic equation':'抛物方程', 'surface duct':'表面声道', 'deep sound channel':'深海声道', 'ray tracing':'射线', 'wave equation':'波动方程'}


class GraphError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def normalize(value):
    return unicodedata.normalize('NFKC', str(value)).lower().strip()


def page(items, offset, limit):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
        raise GraphError('分页需要非负offset和1–50的limit')
    return {'items': items[offset:offset+limit], 'offset': offset, 'limit': limit, 'total': len(items),
            'next_offset': offset+limit if offset+limit < len(items) else None}


def validate_groups(value):
    if not isinstance(value, list) or not value or any(item not in GROUPS for item in value):
        raise GraphError('关系类型只能选择hierarchy、prerequisite或related')
    return list(dict.fromkeys(value))


def validate_direction(value):
    if value not in ('both', 'outgoing', 'incoming'):
        raise GraphError('方向只能选择both、outgoing或incoming')
    return value


def node_view(node):
    return {key: deepcopy(node[key]) for key in FIELDS if key in node}


class GraphTools:
    def __init__(self, graph):
        if not isinstance(graph, dict) or not isinstance(graph.get('nodes'), list) or not isinstance(graph.get('edges'), list):
            raise GraphError('图谱数据不可用', 503)
        self.graph = deepcopy(graph)
        self.nodes = {node['id']: node for node in self.graph['nodes']}

    def require_node(self, identity):
        if not isinstance(identity, str) or identity not in self.nodes:
            raise GraphError('知识节点不存在', 404)
        return self.nodes[identity]

    def edge_view(self, edge):
        return {**deepcopy(edge), 'source_label': self.nodes[edge['source']]['label'],
                'target_label': self.nodes[edge['target']]['label'], 'meaning': NOTE}

    def list_nodes(self, query='', chapter=None, kind='knowledge', offset=0, limit=20):
        if not isinstance(query, str) or len(query) > 200:
            raise GraphError('查询应为不超过200字符的文本')
        if kind not in ('knowledge', 'chapter', 'course', 'all'):
            raise GraphError('节点类型无效')
        if chapter is not None and not any(item['id'] == chapter for item in self.graph['chapters']):
            raise GraphError('课程单元不存在', 404)
        q = normalize(query)
        words = q.split()
        expanded = list(dict.fromkeys(term for name, term in ALIASES.items() if name in q))
        rows = []
        for node in self.graph['nodes']:
            if kind != 'all' and node['kind'] != kind or chapter and node.get('chapter') != chapter and node['id'] != chapter:
                continue
            label = normalize(node['label'])
            text = normalize(' '.join([node['id'], node['label'], node.get('overview', ''), *node.get('tags', []), *node.get('key_points', [])]))
            if q and q not in text and not all(word in text for word in words) and not any(term in text for term in expanded):
                continue
            score = 4 if label == q else 3 if q in label or any(term in label for term in expanded) else 2 if q in normalize(node['id']) else 1
            rows.append((score, node))
        rows.sort(key=lambda item: (-item[0], item[1]['id']))
        return {**page([node_view(node) for _, node in rows], offset, limit), 'expanded_terms': expanded, 'relation_note': NOTE, 'read_only': True}

    def read_node(self, identity):
        return {**node_view(self.require_node(identity)), 'relation_note': NOTE, 'read_only': True}

    def read_relations(self, node_id, groups=GROUPS, direction='both', offset=0, limit=20):
        self.require_node(node_id)
        selected = validate_groups(groups)
        validate_direction(direction)
        rows = [self.edge_view(edge) for edge in self.graph['edges'] if edge['group'] in selected and
                (edge['source'] == node_id if direction == 'outgoing' else edge['target'] == node_id if direction == 'incoming' else node_id in (edge['source'], edge['target']))]
        return {**page(rows, offset, limit), 'node_id': node_id, 'direction': direction, 'relation_note': NOTE, 'read_only': True}

    def find_path(self, source, target, groups=['related'], direction='both', max_depth=8):
        self.require_node(source)
        self.require_node(target)
        selected = validate_groups(groups)
        validate_direction(direction)
        if type(max_depth) is not int or not 1 <= max_depth <= 12:
            raise GraphError('路径深度应为1–12')
        queue = [([source], [])]
        seen = {source}
        for identities, edges in queue:
            identity = identities[-1]
            if identity == target:
                return {'found': True, 'nodes': [node_view(self.nodes[item]) for item in identities], 'edges': edges,
                        'groups': selected, 'direction': direction, 'relation_note': NOTE, 'read_only': True}
            if len(edges) >= max_depth:
                continue
            for edge in self.graph['edges']:
                if edge['group'] not in selected:
                    continue
                next_id = edge['target'] if edge['source'] == identity and direction != 'incoming' else edge['source'] if edge['target'] == identity and direction != 'outgoing' else None
                if next_id is not None and next_id not in seen:
                    seen.add(next_id)
                    queue.append(([*identities, next_id], [*edges, {**self.edge_view(edge), 'traversed_from': identity,
                                  'traversed_to': next_id, 'traversed_reverse': edge['source'] != identity}]))
        return {'found': False, 'nodes': [], 'edges': [], 'groups': selected, 'direction': direction,
                'max_depth': max_depth, 'relation_note': NOTE, 'read_only': True}

    def selection(self, node_ids=None):
        node_ids = [] if node_ids is None else node_ids
        if not isinstance(node_ids, list) or len(node_ids) > 8 or any(not isinstance(item, str) for item in node_ids):
            raise GraphError('最多选择8个知识点ID')
        identities = list(dict.fromkeys(node_ids))
        for identity in identities:
            if self.require_node(identity)['kind'] != 'knowledge':
                raise GraphError('对话上下文只能选择知识点')
        return {'node_ids': identities, 'nodes': [node_view(self.nodes[item]) for item in identities],
                'edges': [self.edge_view(edge) for edge in self.graph['edges'] if edge['source'] in identities and edge['target'] in identities],
                'evidence_type': 'explicit_graph_selection', 'selection_scope': 'current_request', 'relation_note': NOTE, 'read_only': True}

    def execute(self, name, args=None):
        args = args or {}
        if name == 'search_graph_nodes': return self.list_nodes(**args)
        if name == 'read_graph_node': return self.read_node(args['id'])
        if name == 'read_graph_relations': return self.read_relations(**args)
        if name == 'find_graph_path': return self.find_path(**args)
        if name == 'select_graph_nodes': return self.selection(args.get('node_ids'))
        raise GraphError('未知图谱工具')

    def selection_evidence(self, node_ids=None):
        selected = self.selection(node_ids)
        rows = []
        for node in selected['nodes']:
            identity = next((value for value in node.get('source_claim_ids', []) if isinstance(value, str) and value), None)
            reference = next((value for value in node.get('references', []) if isinstance(value.get('source_id'), str) and value['source_id']), None)
            if not identity or not reference:
                continue
            row = {'id': identity, 'node_id': node['id'], 'label': node['label'],
                   'text': ' '.join(filter(None, [node.get('overview'), *node.get('key_points', [])])),
                   'formula': node.get('formula') or '', 'conditions': node.get('conditions') or '适用条件请参见原始资料。',
                   'source_id': reference['source_id'], 'pdf_page': reference.get('pdf_page') or None,
                   'locator': reference.get('locator') or '', 'all_references': deepcopy(node.get('references', [])),
                   'evidence_type': 'knowledge_card', 'retrieval': {'methods': ['explicit_graph_selection'],
                   'role': 'explicit_graph_selection', 'focus': True, 'support_status': 'candidate_only', 'claim_support_verified': False},
                   'related_triples': [{'source': edge['source_label'], 'target': edge['target_label'], 'relation': edge['label'],
                   'relation_kind': edge['group'], 'note': NOTE} for edge in selected['edges'] if node['id'] in (edge['source'], edge['target'])]}
            row['citation'] = {'id': identity, 'label': node['label'], 'node_id': node['id'], 'source_id': row['source_id'],
                              'pdf_page': row['pdf_page'], 'locator': row['locator'],
                              'url': f"/api/source/{row['source_id']}/page/{row['pdf_page']}" if row['pdf_page'] else reference.get('url') or reference.get('code_url'),
                              'evidence_type': 'knowledge_card', 'citation_role': 'retrieval_candidate', 'claim_support_verified': False}
            rows.append(row)
        return rows


def tool_specs():
    text = {'type': 'string'}
    integer = {'type': 'integer'}
    types = {'type': 'array', 'items': {'type': 'string', 'enum': GROUPS}}
    flow = {'type': 'string', 'enum': ['both', 'outgoing', 'incoming']}
    specs = [
        ('search_graph_nodes', 'Search nodes; next_offset pages.', {'query': text, 'chapter': text, 'offset': integer, 'limit': integer}, []),
        ('read_graph_node', 'Read node/formula/conditions/sources.', {'id': text}, ['id']),
        ('read_graph_relations', 'Read typed, directed edges.', {'node_id': text, 'groups': types, 'direction': flow, 'offset': integer, 'limit': integer}, ['node_id']),
        ('find_graph_path', 'Find paths; mark reverse traversal.', {'source': text, 'target': text, 'groups': types, 'direction': flow, 'max_depth': integer}, ['source', 'target']),
        ('select_graph_nodes', 'Select up to 8 nodes; read-only.', {'node_ids': {'type': 'array', 'items': text, 'maxItems': 8}}, ['node_ids']),
    ]
    return [{'type': 'function', 'function': {'name': name, 'description': description,
            'parameters': {'type': 'object', 'properties': deepcopy(properties), 'required': required, 'additionalProperties': False}}}
            for name, description, properties, required in specs]
