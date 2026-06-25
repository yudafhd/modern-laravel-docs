import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { allExpanded, JsonView } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import {
    buildRequest,
    createInitialRequest,
    formatBody,
    getOperations,
    getResponseHeaders,
    getServerUrl,
    parseResponseBody,
    Operation,
    RequestRow,
    RequestState,
    resolveSchema,
    resolveReference,
    generateSnippet
} from './openapi';
import './styles.css';

const openApiUrl = '/docs/api.json';
const transparentDarkJsonStyles = {
    container: 'larafeel-json-container',
    basicChildStyle: 'larafeel-json-child',
    label: 'larafeel-json-label',
    clickableLabel: 'larafeel-json-clickable-label',
    nullValue: 'larafeel-json-null',
    undefinedValue: 'larafeel-json-undefined',
    stringValue: 'larafeel-json-string',
    booleanValue: 'larafeel-json-boolean',
    numberValue: 'larafeel-json-number',
    otherValue: 'larafeel-json-other',
    punctuation: 'larafeel-json-punctuation',
    collapseIcon: 'larafeel-json-collapse-icon',
    expandIcon: 'larafeel-json-expand-icon',
    collapsedContent: 'larafeel-json-collapsed-content',
    noQuotesForStringValues: false,
};

const storageKeys = {
    token: 'ihc-api-client-token',
    history: 'ihc-api-client-history',
    sidebar: 'ihc-api-client-sidebar',
};

function loadStoredValue(key: string, fallback = ''): string {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

interface HistoryItem {
    id: string;
    operationId: string;
    method: string;
    path: string;
    status: number | null;
    createdAt: number;
    request: RequestState;
    token: string;
    cachedResponse?: ResponseState | null;
    cachedError?: string | null;
}

function loadHistory(): HistoryItem[] {
    try {
        return JSON.parse(localStorage.getItem(storageKeys.history) ?? '[]');
    } catch {
        return [];
    }
}

interface SchemaNodeProps {
    name: string;
    schema: any;
    specification: any;
    required?: boolean;
    depth?: number;
}

function SchemaNode({ name, schema, specification, required = false, depth = 0 }: SchemaNodeProps) {
    const resolved = useMemo(() => resolveSchema(specification, schema), [specification, schema]);
    const [expanded, setExpanded] = useState(true);

    if (!resolved) return null;

    const type = Array.isArray(resolved.type)
        ? resolved.type.find((t: any) => t !== 'null') || 'string'
        : resolved.type || 'string';

    const hasChildren = type === 'object' && resolved.properties;

    return (
        <div className="schema-node" style={{ paddingLeft: depth > 0 ? '1rem' : '0' }}>
            <div className="schema-node__header">
                {hasChildren ? (
                    <button
                        type="button"
                        className="schema-node__toggle"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? '▼' : '▶'}
                    </button>
                ) : (
                    <span className="schema-node__indent-bullet" />
                )}

                <span className="schema-node__name">{name || '(root)'}</span>
                {required && <span className="schema-node__required-asterisk" title="Required">*</span>}
                <span className={`schema-node__type-badge schema-node__type-badge--${type}`}>
                    {type}{resolved.format ? ` (${resolved.format})` : ''}
                </span>

                {resolved.description && (
                    <span className="schema-node__description">{resolved.description}</span>
                )}
            </div>

            {expanded && (
                <div className="schema-node__children">
                    {type === 'object' && resolved.properties && (
                        Object.entries(resolved.properties).map(([propName, propSchema]) => (
                            <SchemaNode
                                key={propName}
                                name={propName}
                                schema={propSchema}
                                specification={specification}
                                required={resolved.required?.includes(propName)}
                                depth={depth + 1}
                            />
                        ))
                    )}
                    {type === 'array' && resolved.items && (
                        <SchemaNode
                            name="[item]"
                            schema={resolved.items}
                            specification={specification}
                            depth={depth + 1}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function SchemaVisualizer({ schema, specification }: { schema: any; specification: any }) {
    if (!schema) {
        return <div className="schema-empty">Data schema is not available.</div>;
    }
    return (
        <div className="schema-visualizer">
            <SchemaNode name="" schema={schema} specification={specification} />
        </div>
    );
}

function MethodBadge({ method }: { method: string }) {
    return <span className={`method method--${method.toLowerCase()}`}>{method}</span>;
}

interface SidebarProps {
    groups: [string, Operation[]][];
    selectedId?: string;
    onSelect: (operation: Operation) => void;
    search: string;
    onSearch: (value: string) => void;
    operationCount: number;
    onClose: () => void;
    version: string;
}

function Sidebar({ groups, selectedId, onSelect, search, onSearch, operationCount, onClose, version }: SidebarProps) {
    return (
        <aside className="sidebar">
            <div className="brand">
                <div>
                    <div className="brand__title">Larafeel</div>
                    <span>v{version}</span>
                </div>
                <button className="sidebar-toggle sidebar-toggle--close" type="button" onClick={onClose} aria-label="Close sidebar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <path d="M9 3v18" />
                        <path d="m16 15-3-3 3-3" />
                    </svg>
                </button>
            </div>

            <label className="search">
                <span aria-hidden="true">⌕</span>
                <input
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={`Search ${operationCount} endpoint${operationCount === 1 ? '' : 's'}`}
                />
            </label>

            <nav className="endpoint-nav" aria-label="Endpoints list">
                {groups.length ? groups.map(([tag, operations]) => (
                    <details className="endpoint-group" key={tag} open={Boolean(search) || operations.some((item) => item.id === selectedId)}>
                        <summary>
                            <span>{tag}</span>
                            <small>{operations.length}</small>
                        </summary>
                        <div>
                            {operations.map((operation) => (
                                <button
                                    className={`endpoint ${operation.id === selectedId ? 'endpoint--active' : ''}`}
                                    key={operation.id}
                                    type="button"
                                    onClick={() => onSelect(operation)}
                                >
                                    <MethodBadge method={operation.method} />
                                    <span title={operation.path}>{operation.summary || operation.path}</span>
                                </button>
                            ))}
                        </div>
                    </details>
                )) : (
                    <p className="empty-state">Endpoint tidak ditemukan.</p>
                )}
            </nav>
        </aside>
    );
}

interface KeyValueEditorProps {
    rows: RequestRow[];
    onChange: (rows: RequestRow[]) => void;
    valuePlaceholder?: string;
}

function KeyValueEditor({ rows, onChange, valuePlaceholder = 'Value' }: KeyValueEditorProps) {
    const updateRow = (index: number, field: keyof RequestRow, value: any) => {
        onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    };

    return (
        <div className="kv-editor">
            <div className="kv-editor__head">
                <span>Active</span>
                <span>Key</span>
                <span>Value</span>
                <span />
            </div>
            {rows.map((row, index) => (
                <div className="kv-row" key={row.id}>
                    <input
                        aria-label={`Enable ${row.name || 'parameter'}`}
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) => updateRow(index, 'enabled', event.target.checked)}
                    />
                    <div>
                        <input
                            value={row.name}
                            onChange={(event) => updateRow(index, 'name', event.target.value)}
                            placeholder="Key"
                            readOnly={row.locked}
                        />
                        {row.required && <small>required</small>}
                    </div>
                    <input
                        value={row.value}
                        onChange={(event) => {
                            const val = event.target.value;
                            onChange(rows.map((currentRow, rowIndex) => rowIndex === index
                                ? {
                                    ...currentRow,
                                    value: val,
                                    enabled: val !== '' || currentRow.required,
                                }
                                : currentRow));
                        }}
                        placeholder={row.example ?? valuePlaceholder}
                    />
                    <button
                        className="icon-button"
                        type="button"
                        aria-label="Delete row"
                        disabled={row.locked}
                        onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                    >
                        ×
                    </button>
                </div>
            ))}
            <button
                className="add-row"
                type="button"
                onClick={() => onChange([...rows, {
                    id: crypto.randomUUID(),
                    name: '',
                    value: '',
                    enabled: true,
                    required: false,
                    locked: false,
                    example: '',
                }])}
            >
                + Add row
            </button>
        </div>
    );
}

interface RequestPanelProps {
    operation: Operation;
    request: RequestState;
    onChange: (request: RequestState) => void;
    token: string;
    onTokenChange: (token: string) => void;
    onSend: () => void;
    sending: boolean;
    env: Record<string, string>;
}

function RequestPanel({ operation, request, onChange, token, onTokenChange, onSend, sending, env }: RequestPanelProps) {
    const [tab, setTab] = useState('params');
    const [bodyMode, setBodyMode] = useState('raw');
    const [snippetLang, setSnippetLang] = useState('curl');
    const [copiedSnippet, setCopiedSnippet] = useState(false);

    const requestBodyAvailable = Boolean(operation.requestBody);
    const requestSchema = operation.requestBody?.content?.[request.contentType]?.schema;
    const tabCount = {
        params: request.path.length + request.query.length,
        headers: request.headers.length,
    };

    return (
        <section className="request-panel panel">
            <div className="operation-heading">
                <div>
                    <div className="operation-heading__meta">
                        <MethodBadge method={operation.method} />
                        <code>{operation.path}</code>
                    </div>
                    <h1>{operation.summary || operation.operationId || operation.path}</h1>
                    {operation.description && <p>{operation.description}</p>}
                </div>
                <span className="operation-id">{operation.operationId}</span>
            </div>

            <div className="url-bar">
                <MethodBadge method={operation.method} />
                <input
                    aria-label="Base URL"
                    value={request.baseUrl+operation.path}
                    onChange={(event) => onChange({ ...request, baseUrl: event.target.value })}
                />
                <button type="button" onClick={onSend} disabled={sending}>
                    {sending ? 'Sending…' : 'Send'}
                </button>
            </div>

            <div className="tabs" role="tablist">
                {[
                    ['params', `Params${tabCount.params ? ` (${tabCount.params})` : ''}`],
                    ['headers', `Headers${tabCount.headers ? ` (${tabCount.headers})` : ''}`],
                    ['auth', 'Authorization'],
                    ...(requestBodyAvailable ? [['body', 'Body']] : []),
                ].map(([value, label]) => (
                    <button
                        className={tab === value ? 'tab--active' : ''}
                        key={value}
                        type="button"
                        onClick={() => setTab(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="tab-content">
                {tab === 'params' && (
                    <>
                        {request.path.length > 0 && (
                            <div className="editor-section">
                                <h2>Path variables</h2>
                                <KeyValueEditor rows={request.path} onChange={(path) => onChange({ ...request, path })} />
                            </div>
                        )}
                        <div className="editor-section">
                            <h2>Query parameters</h2>
                            <KeyValueEditor rows={request.query} onChange={(query) => onChange({ ...request, query })} />
                        </div>
                    </>
                )}

                {tab === 'headers' && (
                    <div className="editor-section">
                        <h2>Request headers</h2>
                        <KeyValueEditor rows={request.headers} onChange={(headers) => onChange({ ...request, headers })} />
                    </div>
                )}

                {tab === 'auth' && (
                    <div className="auth-editor">
                        <label>
                            <span>Type</span>
                            <select
                                value={request.authType}
                                onChange={(event) => onChange({ ...request, authType: event.target.value })}
                            >
                                <option value="none">No Auth</option>
                                <option value="bearer">Bearer Token</option>
                                <option value="basic">Basic Auth</option>
                                <option value="apikey">API Key</option>
                            </select>
                        </label>
                        {request.authType === 'bearer' && (
                            <label>
                                <span>Token</span>
                                <textarea
                                    value={token}
                                    onChange={(event) => onTokenChange(event.target.value)}
                                    placeholder="Paste access token"
                                    rows={5}
                                    spellCheck="false"
                                />
                                <small>Token is stored only in your browser's localStorage.</small>
                            </label>
                        )}
                        {request.authType === 'basic' && (
                            <div className="auth-basic-fields">
                                <label>
                                    <span>Username</span>
                                    <input
                                        type="text"
                                        value={request.basicAuthUsername || ''}
                                        onChange={(event) => onChange({ ...request, basicAuthUsername: event.target.value })}
                                        placeholder="Username"
                                    />
                                </label>
                                <label>
                                    <span>Password</span>
                                    <input
                                        type="password"
                                        value={request.basicAuthPassword || ''}
                                        onChange={(event) => onChange({ ...request, basicAuthPassword: event.target.value })}
                                        placeholder="Password"
                                     />
                                </label>
                            </div>
                        )}
                        {request.authType === 'apikey' && (
                            <div className="auth-apikey-fields">
                                <label>
                                    <span>Key</span>
                                    <input
                                        type="text"
                                        value={request.apiKeyName || ''}
                                        onChange={(event) => onChange({ ...request, apiKeyName: event.target.value })}
                                        placeholder="api_key"
                                    />
                                </label>
                                <label>
                                    <span>Value</span>
                                    <input
                                        type="text"
                                        value={request.apiKeyValue || ''}
                                        onChange={(event) => onChange({ ...request, apiKeyValue: event.target.value })}
                                        placeholder="secret-token-value"
                                    />
                                </label>
                                <label>
                                    <span>Add to</span>
                                    <select
                                        value={request.apiKeyPlacement || 'header'}
                                        onChange={(event) => onChange({ ...request, apiKeyPlacement: event.target.value as 'header' | 'query' })}
                                    >
                                        <option value="header">Header</option>
                                        <option value="query">Query Params</option>
                                    </select>
                                </label>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'body' && (
                    <div className="body-editor">
                        <div className="body-editor__toolbar">
                            {operation.contentTypes.length > 1 ? (
                                <label>
                                    <span>Content-Type</span>
                                    <select
                                        value={request.contentType}
                                        onChange={(event) => {
                                            const contentType = event.target.value;
                                            const example = operation.bodyExamples[contentType];
                                            onChange({
                                                ...request,
                                                contentType,
                                                body: example === undefined || example === null
                                                    ? ''
                                                    : JSON.stringify(example, null, 2),
                                            });
                                        }}
                                    >
                                        {operation.contentTypes.map((contentType) => (
                                            <option key={contentType}>{contentType}</option>
                                        ))}
                                    </select>
                                </label>
                            ) : (
                                <div className="content-type-badge-container">
                                    <span className="content-type-badge-label">Content-Type:</span>
                                    <code className="content-type-badge-value">{request.contentType}</code>
                                </div>
                            )}
                            {request.contentType.includes('json') && (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <div className="segmented-control">
                                        <button
                                            type="button"
                                            className={bodyMode === 'raw' ? 'active' : ''}
                                            onClick={() => setBodyMode('raw')}
                                        >
                                            Raw
                                        </button>
                                        <button
                                            type="button"
                                            className={bodyMode === 'preview' ? 'active' : ''}
                                            onClick={() => setBodyMode('preview')}
                                        >
                                            Preview
                                        </button>
                                        {requestSchema && (
                                            <button
                                                type="button"
                                                className={bodyMode === 'schema' ? 'active' : ''}
                                                onClick={() => setBodyMode('schema')}
                                            >
                                                Schema
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        {bodyMode === 'schema' && requestSchema ? (
                            <div className="schema-container">
                                <SchemaVisualizer schema={requestSchema} specification={operation.specification} />
                            </div>
                        ) : bodyMode === 'preview' && request.contentType.includes('json') ? (
                            (() => {
                                try {
                                    const parsed = JSON.parse(request.body || '{}');
                                    return (
                                        <div className="response-json" style={{ minHeight: '18rem', borderRadius: '0.55rem' }}>
                                            <JsonView
                                                data={parsed}
                                                shouldExpandNode={allExpanded}
                                                style={transparentDarkJsonStyles}
                                                clickToExpandNode
                                            />
                                        </div>
                                    );
                                } catch (e: any) {
                                    return (
                                        <div className="response-body response-body--error" style={{ minHeight: '18rem', borderRadius: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            Invalid JSON: {e.message}
                                        </div>
                                    );
                                }
                            })()
                        ) : (
                            <textarea
                                className="code-editor"
                                value={request.body}
                                onChange={(event) => onChange({ ...request, body: event.target.value })}
                                onBlur={() => {
                                    if (request.contentType.includes('json')) {
                                        onChange({ ...request, body: formatBody(request.body) });
                                    }
                                }}
                                rows={18}
                                spellCheck="false"
                                placeholder={request.contentType === 'multipart/form-data'
                                    ? 'Use a JSON object. Values will be sent as FormData.'
                                    : 'Request body'}
                            />
                        )}
                        {request.contentType === 'multipart/form-data' && (
                            <div className="editor-section" style={{ marginTop: '1.5rem' }}>
                                <h2>File Attachments (Multipart)</h2>
                                <div className="kv-editor">
                                    <div className="kv-editor__head">
                                        <span>Active</span>
                                        <span>Field Name</span>
                                        <span>File</span>
                                        <span />
                                    </div>
                                    {(request.files ?? []).map((row, index) => (
                                        <div className="kv-row" key={row.id}>
                                            <input
                                                aria-label={`Enable file ${row.name || 'field'}`}
                                                type="checkbox"
                                                checked={row.enabled}
                                                onChange={(event) => {
                                                    const updated = [...request.files];
                                                    updated[index].enabled = event.target.checked;
                                                    onChange({ ...request, files: updated });
                                                }}
                                            />
                                            <input
                                                value={row.name}
                                                onChange={(event) => {
                                                    const updated = [...request.files];
                                                    updated[index].name = event.target.value;
                                                    onChange({ ...request, files: updated });
                                                }}
                                                placeholder="e.g. file"
                                            />
                                            <input
                                                type="file"
                                                onChange={(event) => {
                                                    const fileObj = event.target.files?.[0] || null;
                                                    const updated = [...request.files];
                                                    updated[index].file = fileObj;
                                                    if (fileObj && !row.name) {
                                                        updated[index].name = 'file';
                                                    }
                                                    onChange({ ...request, files: updated });
                                                }}
                                            />
                                            <button
                                                className="icon-button"
                                                type="button"
                                                aria-label="Delete file"
                                                onClick={() => {
                                                    onChange({
                                                        ...request,
                                                        files: request.files.filter((_, i) => i !== index),
                                                    });
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        style={{
                                            marginTop: '0.75rem',
                                            padding: '0.25rem 0.75rem',
                                            fontSize: '0.85rem',
                                            cursor: 'pointer',
                                            border: '1px dashed #2f91ff',
                                            borderRadius: '4px',
                                            color: '#2f91ff',
                                            backgroundColor: 'transparent',
                                        }}
                                        onClick={() => {
                                            onChange({
                                                ...request,
                                                files: [
                                                    ...(request.files ?? []),
                                                    { id: crypto.randomUUID(), name: '', file: null, enabled: true, required: false, locked: false },
                                                ],
                                            });
                                        }}
                                    >
                                        + Add File
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {(() => {
                let snippet = '';
                let errorMsg = '';
                try {
                    const prepared = buildRequest(operation, request, token, env);
                    snippet = generateSnippet(snippetLang, prepared.url, prepared.options, request.contentType);
                } catch (e: any) {
                    errorMsg = `// Error: ${e.message}\n// Complete required parameters to generate the code snippet.`;
                }

                const handleCopy = () => {
                    navigator.clipboard.writeText(snippet || errorMsg);
                    setCopiedSnippet(true);
                    setTimeout(() => setCopiedSnippet(false), 2000);
                };

                return (
                    <div className="snippet-box" style={{ marginTop: '1.5rem' }}>
                        <div className="snippet-box__header">
                            <select value={snippetLang} onChange={(e) => setSnippetLang(e.target.value)}>
                                <option value="curl">cURL</option>
                                <option value="javascript">JavaScript (Fetch)</option>
                                <option value="python">Python (Requests)</option>
                                <option value="php">PHP (Guzzle)</option>
                            </select>
                            <button type="button" onClick={handleCopy}>
                                {copiedSnippet ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <pre className="snippet-box__code"><code>{snippet || errorMsg}</code></pre>
                    </div>
                );
            })()}
        </section>
    );
}

interface ResponseState {
    ok: boolean;
    status: number;
    statusText: string;
    duration: number;
    size: string;
    headers: [string, string][];
    body: string;
    json: any;
    contentType: string;
}

interface ResponsePanelProps {
    response: ResponseState | null;
    error: string | null;
    operation: Operation | null;
}

function ResponsePanel({ response, error, operation }: ResponsePanelProps) {
    const [tab, setTab] = useState('body');
    const [search, setSearch] = useState('');
    const [matches, setMatches] = useState<HTMLElement[]>([]);
    const [activeMatch, setActiveMatch] = useState(0);
    const [copiedResponse, setCopiedResponse] = useState(false);
    const bodyRef = useRef<any>(null);

    const successResponse = operation?.responses?.[response?.status ?? 200]
        ?? operation?.responses?.['201']
        ?? operation?.responses?.default;
    const successMedia = successResponse
        ? resolveReference(operation?.specification, successResponse)
        : null;
    const responseSchema = successMedia?.content?.['application/json']?.schema
        ?? successMedia?.content?.['*/*']?.schema;

    const handleCopy = () => {
        if (!response) return;
        navigator.clipboard.writeText(response.body);
        setCopiedResponse(true);
        setTimeout(() => setCopiedResponse(false), 2000);
    };

    const handleDownload = () => {
        if (!response) return;
        let extension = 'txt';
        const type = response.contentType.toLowerCase();
        if (type.includes('json')) extension = 'json';
        else if (type.includes('html')) extension = 'html';
        else if (type.includes('xml')) extension = 'xml';

        const blob = new Blob([response.body], { type: response.contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `response_${response.status}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const clearHighlights = () => {
        if (!bodyRef.current) return;

        bodyRef.current.querySelectorAll('mark.response-match').forEach((mark: any) => {
            mark.replaceWith(document.createTextNode(mark.textContent || ''));
        });
        bodyRef.current.normalize();
    };

    useEffect(() => {
        setSearch('');
        setMatches([]);
        setActiveMatch(0);
    }, [response]);

    useEffect(() => {
        clearHighlights();

        const term = search.trim();
        if (tab !== 'body' || !term || !bodyRef.current) {
            setMatches([]);
            setActiveMatch(0);
            return undefined;
        }

        const root = bodyRef.current;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue?.trim() || (node.parentElement as HTMLElement)?.closest('mark.response-match')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        const nodes: Text[] = [];
        let currentNode: Node | null;
        while ((currentNode = walker.nextNode())) nodes.push(currentNode as Text);

        const normalizedTerm = term.toLocaleLowerCase();
        const found: HTMLElement[] = [];

        nodes.forEach((node) => {
            const text = node.nodeValue || '';
            const normalizedText = text.toLocaleLowerCase();
            let cursor = 0;
            let matchIndex = normalizedText.indexOf(normalizedTerm, cursor);
            if (matchIndex === -1) return;

            const fragment = document.createDocumentFragment();
            while (matchIndex !== -1) {
                fragment.append(text.slice(cursor, matchIndex));
                const mark = document.createElement('mark');
                mark.className = 'response-match';
                mark.textContent = text.slice(matchIndex, matchIndex + term.length);
                fragment.append(mark);
                found.push(mark);
                cursor = matchIndex + term.length;
                matchIndex = normalizedText.indexOf(normalizedTerm, cursor);
            }
            fragment.append(text.slice(cursor));
            node.replaceWith(fragment);
        });

        setMatches(found);
        setActiveMatch(0);

        return clearHighlights;
    }, [search, tab, response]);

    useEffect(() => {
        matches.forEach((match, index) => {
            match.classList.toggle('response-match--active', index === activeMatch);
        });
    }, [activeMatch, matches]);

    const moveMatch = (direction: number) => {
        if (!matches.length) return;
        const next = (activeMatch + direction + matches.length) % matches.length;
        setActiveMatch(next);
        matches[next]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    };

    if (!response && !error) {
        return (
            <section className="response-panel panel response-panel--empty">
                <div className="response-placeholder">
                    <span>↗</span>
                    <h2>Response will appear here</h2>
                    <p>Configure the request and click Send.</p>
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="response-panel panel">
                <div className="response-title">
                    <h2>Request failed</h2>
                    <span className="status status--error">Error</span>
                </div>
                <pre className="response-body response-body--error">{error}</pre>
            </section>
        );
    }

    return (
        <section className="response-panel panel">
            <div className="response-title">
                <h2>Response</h2>
                {response && (
                    <div>
                        <span className={`status ${response.ok ? 'status--ok' : 'status--error'}`}>
                            {response.status} {response.statusText}
                        </span>
                        <span>{response.duration} ms</span>
                        <span>{response.size}</span>
                    </div>
                )}
            </div>
            <div className="tabs">
                <button className={tab === 'body' ? 'tab--active' : ''} type="button" onClick={() => setTab('body')}>
                    Body
                </button>
                {response && (
                    <button className={tab === 'headers' ? 'tab--active' : ''} type="button" onClick={() => setTab('headers')}>
                        Headers ({response.headers.length})
                    </button>
                )}
                {responseSchema && (
                    <button className={tab === 'schema' ? 'tab--active' : ''} type="button" onClick={() => setTab('schema')}>
                        Schema
                    </button>
                )}
            </div>
            {tab === 'body' && (
                <div className="response-search">
                    <label>
                        <span aria-hidden="true">⌕</span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search response body"
                        />
                    </label>
                    <span>{search ? `${matches.length ? activeMatch + 1 : 0}/${matches.length}` : ''}</span>
                    <button type="button" onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Previous match">↑</button>
                    <button type="button" onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Next match">↓</button>
                    
                    <div className="response-actions">
                        <button type="button" className="response-action-btn" onClick={handleCopy}>
                            {copiedResponse ? 'Copied!' : 'Copy'}
                        </button>
                        <button type="button" className="response-action-btn" onClick={handleDownload}>
                            Download
                        </button>
                    </div>
                </div>
            )}
            {response && (
                tab === 'body' ? (
                    response.json !== null ? (
                        <div className="response-json" ref={bodyRef}>
                            <JsonView
                                data={response.json}
                                shouldExpandNode={allExpanded}
                                style={transparentDarkJsonStyles}
                                clickToExpandNode
                            />
                        </div>
                    ) : (
                        <pre className="response-body" ref={bodyRef}>{response.body}</pre>
                    )
                ) : tab === 'schema' && responseSchema ? (
                    <div className="schema-container" style={{ padding: '1rem' }}>
                        <SchemaVisualizer schema={responseSchema} specification={operation?.specification} />
                    </div>
                ) : (
                    <div className="response-headers">
                        {response.headers.map(([name, value]) => (
                            <div key={name}>
                                <code>{name}</code>
                                <span>{value}</span>
                            </div>
                        ))}
                    </div>
                )
            )}
        </section>
    );
}

function EnvModal({ isOpen, env, onClose, onSave }: { isOpen: boolean; env: Record<string, string>; onClose: () => void; onSave: (newEnv: Record<string, string>) => void }) {
    const [localVars, setLocalVars] = useState<{ id: string; name: string; value: string }[]>(() => {
        return Object.entries(env).map(([name, value]) => ({ id: crypto.randomUUID(), name, value }));
    });

    useEffect(() => {
        if (isOpen) {
            setLocalVars(Object.entries(env).map(([name, value]) => ({ id: crypto.randomUUID(), name, value })));
        }
    }, [isOpen, env]);

    if (!isOpen) return null;

    const handleSave = () => {
        const updatedEnv: Record<string, string> = {};
        localVars.forEach((v) => {
            const name = v.name.trim();
            if (name) {
                updatedEnv[name] = v.value;
            }
        });
        onSave(updatedEnv);
        onClose();
    };

    const addVar = () => {
        setLocalVars([...localVars, { id: crypto.randomUUID(), name: '', value: '' }]);
    };

    const updateVar = (id: string, field: 'name' | 'value', val: string) => {
        setLocalVars(localVars.map((v) => v.id === id ? { ...v, [field]: val } : v));
    };

    const deleteVar = (id: string) => {
        setLocalVars(localVars.filter((v) => v.id !== id));
    };

    return (
        <div className="env-modal-backdrop" onClick={onClose}>
            <div className="env-modal" onClick={(e) => e.stopPropagation()}>
                <div className="env-modal__header">
                    <h2>Environment Variables</h2>
                    <button type="button" className="env-modal__close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="env-modal__body">
                    <p className="env-modal__help">
                        Define variables to reference in URL, query parameters, headers, or request body using double curly braces (e.g. <code>{"{{"}my_variable{"}}"}</code>).
                    </p>
                    <div className="env-vars-list">
                        <div className="env-vars-header">
                            <span>Key</span>
                            <span>Value</span>
                            <span />
                        </div>
                        {localVars.map((v) => (
                            <div className="env-vars-row" key={v.id}>
                                <input
                                    type="text"
                                    value={v.name}
                                    onChange={(e) => updateVar(v.id, 'name', e.target.value)}
                                    placeholder="e.g. token"
                                />
                                <input
                                    type="text"
                                    value={v.value}
                                    onChange={(e) => updateVar(v.id, 'value', e.target.value)}
                                    placeholder="value"
                                />
                                <button type="button" className="env-var-delete" onClick={() => deleteVar(v.id)}>
                                    &times;
                                </button>
                            </div>
                        ))}
                        {localVars.length === 0 && (
                            <div className="env-vars-empty">No variables defined. Click the button below to add one.</div>
                        )}
                    </div>
                    <button type="button" className="env-vars-add" onClick={addVar}>
                        + Add Variable
                    </button>
                </div>
                <div className="env-modal__footer">
                    <button type="button" className="env-modal-btn env-modal-btn--secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="env-modal-btn env-modal-btn--primary" onClick={handleSave}>Save Changes</button>
                </div>
            </div>
        </div>
    );
}

interface ThemeToggleProps {
    theme: string;
    onChange: (theme: string) => void;
}

function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
    return (
        <button
            type="button"
            className="theme-toggle"
            onClick={() => onChange(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
            {theme === 'dark' ? '☀️' : '🌙'}
        </button>
    );
}

interface HistoryDrawerProps {
    history: HistoryItem[];
    onSelect: (item: HistoryItem) => void;
    onClear: () => void;
}

function HistoryDrawer({ history, onSelect, onClear }: HistoryDrawerProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="history">
            <button type="button" onClick={() => setOpen((value) => !value)}>
                History <span>{history.length}</span>
            </button>
            {open && (
                <div className="history__menu">
                    <div>
                        <strong>Recent requests</strong>
                        <button type="button" onClick={onClear}>Clear</button>
                    </div>
                    {history.length ? history.map((item) => (
                        <button key={item.id} type="button" onClick={() => onSelect(item)}>
                            <MethodBadge method={item.method} />
                            <span>
                                <strong>{item.path}</strong>
                                <small>{item.status ?? 'Error'} · {new Date(item.createdAt).toLocaleString('en-US')}</small>
                            </span>
                        </button>
                    )) : <p>No recent requests.</p>}
                </div>
            )}
        </div>
    );
}

function ApiWorkspace({ specification }: { specification: any }) {
    const operations = useMemo(() => getOperations(specification), [specification]);
    const [selected, setSelected] = useState<Operation | null>(operations[0] || null);
    const [search, setSearch] = useState('');
    const [request, setRequest] = useState<RequestState>(() => operations[0] ? createInitialRequest(operations[0], getServerUrl(specification)) : {
        baseUrl: '', path: [], query: [], headers: [], authType: 'bearer', contentType: 'application/json', body: '', files: []
    });
    const [env, setEnv] = useState<Record<string, string>>(() => {
        try {
            const stored = localStorage.getItem('larafeel-env-variables');
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    });
    const [showEnvModal, setShowEnvModal] = useState(false);

    const saveEnv = (newEnv: Record<string, string>) => {
        setEnv(newEnv);
        try {
            localStorage.setItem('larafeel-env-variables', JSON.stringify(newEnv));
        } catch {
            // LocalStorage can be disabled
        }
    };
    const [token, setToken] = useState(() => loadStoredValue(storageKeys.token));
    const [response, setResponse] = useState<ResponseState | null>(null);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
    const [sidebarOpen, setSidebarOpen] = useState(() => loadStoredValue(storageKeys.sidebar, 'open') !== 'closed');
    const [theme, setTheme] = useState(() => {
        const stored = localStorage.getItem('larafeel-theme');
        if (stored) return stored;

        const configTheme = specification.ui?.theme || 'system';
        if (configTheme === 'system') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return configTheme;
    });

    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
            root.setAttribute('data-theme', 'dark');
        } else {
            root.classList.remove('dark');
            root.setAttribute('data-theme', 'light');
        }
        localStorage.setItem('larafeel-theme', theme);
    }, [theme]);

    const filteredGroups = useMemo((): [string, Operation[]][] => {
        const term = search.trim().toLowerCase();
        const filtered = term
            ? operations.filter((operation) => [
                operation.method,
                operation.path,
                operation.summary,
                operation.operationId,
                operation.tag,
            ].some((value) => value?.toLowerCase().includes(term)))
            : operations;

        const grouped = filtered.reduce((result: Record<string, Operation[]>, operation) => {
            result[operation.tag] ??= [];
            result[operation.tag].push(operation);
            return result;
        }, {});

        return Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
    }, [operations, search]);

    const chooseOperation = (operation: Operation) => {
        setSelected(operation);
        setRequest(createInitialRequest(operation, request.baseUrl || getServerUrl(specification)));
        setResponse(null);
        setRequestError(null);
    };

    const saveToken = (value: string) => {
        setToken(value);
        try {
            localStorage.setItem(storageKeys.token, value);
        } catch {
            // Storage can be disabled by browser policy; the in-memory token still works.
        }
    };

    const toggleSidebar = () => {
        setSidebarOpen((current) => {
            const next = !current;
            try {
                localStorage.setItem(storageKeys.sidebar, next ? 'open' : 'closed');
            } catch {
                // The sidebar still works when browser storage is unavailable.
            }
            return next;
        });
    };

    const saveHistory = (item: HistoryItem) => {
        const next = [item, ...history].slice(0, 20);
        setHistory(next);
        try {
            localStorage.setItem(storageKeys.history, JSON.stringify(next));
        } catch {
            // Keep history in memory when storage is unavailable.
        }
    };

    const createHistoryItem = (
        status: number | null,
        cachedResponse?: ResponseState | null,
        cachedError?: string | null
    ): HistoryItem => ({
        id: crypto.randomUUID(),
        operationId: selected?.id || '',
        method: selected?.method || '',
        path: selected?.path || '',
        status,
        createdAt: Date.now(),
        request: structuredClone(request),
        token,
        cachedResponse,
        cachedError,
    });

    const restoreHistoryItem = (item: HistoryItem) => {
        const operation = operations.find((candidate) => candidate.id === item.operationId);
        if (!operation) return;

        setSelected(operation);
        setRequest(item.request
            ? structuredClone(item.request)
            : createInitialRequest(operation, request.baseUrl || getServerUrl(specification)));
        if (typeof item.token === 'string') {
            saveToken(item.token);
        }
        
        if (item.cachedResponse) {
            setResponse(item.cachedResponse);
            setRequestError(null);
        } else if (item.cachedError) {
            setResponse(null);
            setRequestError(item.cachedError);
        } else {
            setResponse(null);
            setRequestError(null);
        }
    };

    const sendRequest = async () => {
        if (!selected) return;
        setSending(true);
        setRequestError(null);
        setResponse(null);

        try {
            const prepared = buildRequest(selected, request, token, env);
            const startedAt = performance.now();
            const result = await fetch(prepared.url, prepared.options);
            const rawBody = await result.text();
            const duration = Math.round(performance.now() - startedAt);
            const parsedBody = parseResponseBody(rawBody, result.headers.get('content-type') || '');
            const responseData: ResponseState = {
                ok: result.ok,
                status: result.status,
                statusText: result.statusText,
                duration,
                size: `${new Blob([rawBody]).size.toLocaleString('en-US')} B`,
                headers: getResponseHeaders(result.headers),
                body: parsedBody.text,
                json: parsedBody.json,
                contentType: result.headers.get('content-type') || '',
            };

            setResponse(responseData);
            saveHistory(createHistoryItem(result.status, responseData, null));
        } catch (error: any) {
            setRequestError(error.message);
            saveHistory(createHistoryItem(null, null, error.message));
        } finally {
            setSending(false);
        }
    };

    return (
        <main className={`workspace ${sidebarOpen ? '' : 'workspace--sidebar-closed'}`}>
            <Sidebar
                groups={filteredGroups}
                selectedId={selected?.id}
                onSelect={chooseOperation}
                search={search}
                onSearch={setSearch}
                operationCount={operations.length}
                onClose={toggleSidebar}
                version={specification.info?.version || specification.openapi}
            />
            <section className="workspace__main">
                <header className="topbar">
                    <div>
                        {!sidebarOpen && (
                            <>
                                <button
                                    className="sidebar-toggle sidebar-toggle--open"
                                    type="button"
                                    onClick={toggleSidebar}
                                    aria-label="Open sidebar"
                                    aria-expanded="false"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                                        <rect width="18" height="18" x="3" y="3" rx="2" />
                                        <path d="M9 3v18" />
                                        <path d="m14 9 3 3-3 3" />
                                    </svg>
                                </button>
                                <span className="topbar__dot" />
                                <strong>{specification.info?.title || 'API'}</strong>
                                <span>v{specification.info?.version || specification.openapi}</span>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <button
                            type="button"
                            className="variables-btn"
                            onClick={() => setShowEnvModal(true)}
                            aria-label="Manage environment variables"
                            title="Environment Variables"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                        <ThemeToggle theme={theme} onChange={setTheme} />
                        <HistoryDrawer
                            history={history}
                            onSelect={restoreHistoryItem}
                            onClear={() => {
                                setHistory([]);
                                localStorage.removeItem(storageKeys.history);
                            }}
                        />
                    </div>
                </header>
                <div className="workspace__content">
                    {selected ? (
                        <RequestPanel
                            key={selected.id}
                            operation={selected}
                            request={request}
                            onChange={setRequest}
                            token={token}
                            onTokenChange={saveToken}
                            onSend={sendRequest}
                            sending={sending}
                            env={env}
                        />
                    ) : (
                        <div className="panel" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                            <h2>No endpoint selected</h2>
                            <p>Please create API routes in Laravel or select an endpoint from the sidebar.</p>
                        </div>
                    )}
                    <ResponsePanel response={response} error={requestError} operation={selected} />
                </div>
            </section>
            <EnvModal isOpen={showEnvModal} env={env} onClose={() => setShowEnvModal(false)} onSave={saveEnv} />
        </main>
    );
}

function ApiDocumentation() {
    const [specification, setSpecification] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        fetch(openApiUrl, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        })
            .then((response) => {
                if (!response.ok) throw new Error(`OpenAPI document returned HTTP ${response.status}.`);
                return response.json();
            })
            .then(setSpecification)
            .catch((loadError) => {
                if (loadError.name !== 'AbortError') setError(loadError.message);
            });

        return () => controller.abort();
    }, []);

    if (error) {
        return (
            <main className="docs-error">
                <section>
                    <p>IHC ONE API</p>
                    <h1>Documentation could not be loaded</h1>
                    <span>{error}</span>
                    <button type="button" onClick={() => window.location.reload()}>Reload</button>
                </section>
            </main>
        );
    }

    if (!specification) {
        return (
            <main className="docs-loading">
                <p>
                    <strong className="loading-text">Preparing Documentation</strong>
                    <span className="loading-dots" aria-hidden="true">
                        <i>.</i><i>.</i><i>.</i>
                    </span>
                </p>
            </main>
        );
    }

    return <ApiWorkspace specification={specification} />;
}

createRoot(document.getElementById('docs-root')!).render(
    <React.StrictMode>
        <ApiDocumentation />
    </React.StrictMode>,
);
