import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { allExpanded, darkStyles, JsonView } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import {
    buildRequest,
    createInitialRequest,
    formatBody,
    getOperations,
    getResponseHeaders,
    getServerUrl,
    parseResponseBody,
} from './openapi';
import './styles.css';

const openApiUrl = '/docs/api.json';
const transparentDarkJsonStyles = {
    ...darkStyles,
    container: 'json-view-transparent',
};

const storageKeys = {
    token: 'ihc-api-client-token',
    history: 'ihc-api-client-history',
    sidebar: 'ihc-api-client-sidebar',
};

function loadStoredValue(key, fallback = '') {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(storageKeys.history) ?? '[]');
    } catch {
        return [];
    }
}

function MethodBadge({ method }) {
    return <span className={`method method--${method.toLowerCase()}`}>{method}</span>;
}

function Sidebar({ groups, selectedId, onSelect, search, onSearch, operationCount, onClose, version }) {
    return (
        <aside className="sidebar">
            <div className="brand">
                <div>
                    <div className="brand__title">Larafeel</div>
                    <span>v{version}</span>
                </div>
                <button className="sidebar-toggle sidebar-toggle--close" type="button" onClick={onClose} aria-label="Tutup sidebar">
                    ‹
                </button>
            </div>

            <label className="search">
                <span aria-hidden="true">⌕</span>
                <input
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={`Cari ${operationCount} endpoint`}
                />
            </label>

            <nav className="endpoint-nav" aria-label="Daftar endpoint">
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

function KeyValueEditor({ rows, onChange, valuePlaceholder = 'Nilai' }) {
    const updateRow = (index, field, value) => {
        onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    };

    return (
        <div className="kv-editor">
            <div className="kv-editor__head">
                <span>Aktif</span>
                <span>Key</span>
                <span>Value</span>
                <span />
            </div>
            {rows.map((row, index) => (
                <div className="kv-row" key={row.id}>
                    <input
                        aria-label={`Aktifkan ${row.name || 'parameter'}`}
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
                            const value = event.target.value;
                            onChange(rows.map((currentRow, rowIndex) => rowIndex === index
                                ? {
                                    ...currentRow,
                                    value,
                                    enabled: value !== '' || currentRow.required,
                                }
                                : currentRow));
                        }}
                        placeholder={row.example ?? valuePlaceholder}
                    />
                    <button
                        className="icon-button"
                        type="button"
                        aria-label="Hapus baris"
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
                }])}
            >
                + Tambah baris
            </button>
        </div>
    );
}

function RequestPanel({ operation, request, onChange, token, onTokenChange, onSend, sending }) {
    const [tab, setTab] = useState('params');
    const requestBodyAvailable = Boolean(operation.requestBody);
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
                                <option value="bearer">Bearer Token</option>
                                <option value="none">No Auth</option>
                            </select>
                        </label>
                        {request.authType === 'bearer' && (
                            <label>
                                <span>Token</span>
                                <textarea
                                    value={token}
                                    onChange={(event) => onTokenChange(event.target.value)}
                                    placeholder="Paste access token"
                                    rows="5"
                                    spellCheck="false"
                                />
                                <small>Token disimpan hanya di localStorage browser ini.</small>
                            </label>
                        )}
                    </div>
                )}

                {tab === 'body' && (
                    <div className="body-editor">
                        <div className="body-editor__toolbar">
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
                            {request.contentType.includes('json') && (
                                <button
                                    type="button"
                                    onClick={() => onChange({ ...request, body: formatBody(request.body) })}
                                >
                                    Format JSON
                                </button>
                            )}
                        </div>
                        <textarea
                            className="code-editor"
                            value={request.body}
                            onChange={(event) => onChange({ ...request, body: event.target.value })}
                            rows="18"
                            spellCheck="false"
                            placeholder={request.contentType === 'multipart/form-data'
                                ? 'Gunakan JSON object. Nilai akan dikirim sebagai FormData.'
                                : 'Request body'}
                        />
                        {request.contentType === 'multipart/form-data' && (
                            <div className="editor-section" style={{ marginTop: '1.5rem' }}>
                                <h2>File Attachments (Multipart)</h2>
                                <div className="kv-editor">
                                    <div className="kv-editor__head">
                                        <span>Aktif</span>
                                        <span>Field Name</span>
                                        <span>File</span>
                                        <span />
                                    </div>
                                    {(request.files ?? []).map((row, index) => (
                                        <div className="kv-row" key={row.id}>
                                            <input
                                                aria-label={`Aktifkan file ${row.name || 'field'}`}
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
                                                aria-label="Hapus file"
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
                                                    { id: crypto.randomUUID(), name: '', file: null, enabled: true },
                                                ],
                                            });
                                        }}
                                    >
                                        + Tambah File
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

function ResponsePanel({ response, error }) {
    const [tab, setTab] = useState('body');
    const [search, setSearch] = useState('');
    const [matches, setMatches] = useState([]);
    const [activeMatch, setActiveMatch] = useState(0);
    const bodyRef = useRef(null);

    const clearHighlights = () => {
        if (!bodyRef.current) return;

        bodyRef.current.querySelectorAll('mark.response-match').forEach((mark) => {
            mark.replaceWith(document.createTextNode(mark.textContent));
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
                if (!node.nodeValue?.trim() || node.parentElement?.closest('mark.response-match')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        const nodes = [];
        let currentNode;
        while ((currentNode = walker.nextNode())) nodes.push(currentNode);

        const normalizedTerm = term.toLocaleLowerCase();
        const found = [];

        nodes.forEach((node) => {
            const text = node.nodeValue;
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

    const moveMatch = (direction) => {
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
                    <h2>Response akan tampil di sini</h2>
                    <p>Lengkapi request, lalu tekan Send.</p>
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
                <div>
                    <span className={`status ${response.ok ? 'status--ok' : 'status--error'}`}>
                        {response.status} {response.statusText}
                    </span>
                    <span>{response.duration} ms</span>
                    <span>{response.size}</span>
                </div>
            </div>
            <div className="tabs">
                <button className={tab === 'body' ? 'tab--active' : ''} type="button" onClick={() => setTab('body')}>
                    Body
                </button>
                <button className={tab === 'headers' ? 'tab--active' : ''} type="button" onClick={() => setTab('headers')}>
                    Headers ({response.headers.length})
                </button>
            </div>
            {tab === 'body' && (
                <div className="response-search">
                    <label>
                        <span aria-hidden="true">⌕</span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Cari di response body"
                        />
                    </label>
                    <span>{search ? `${matches.length ? activeMatch + 1 : 0}/${matches.length}` : ''}</span>
                    <button type="button" onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Hasil sebelumnya">↑</button>
                    <button type="button" onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Hasil berikutnya">↓</button>
                </div>
            )}
            {tab === 'body' ? (
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
            ) : (
                <div className="response-headers">
                    {response.headers.map(([name, value]) => (
                        <div key={name}>
                            <code>{name}</code>
                            <span>{value}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function HistoryDrawer({ history, onSelect, onClear }) {
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
                                <small>{item.status ?? 'Error'} · {new Date(item.createdAt).toLocaleString('id-ID')}</small>
                            </span>
                        </button>
                    )) : <p>Belum ada request.</p>}
                </div>
            )}
        </div>
    );
}

function ApiWorkspace({ specification }) {
    const operations = useMemo(() => getOperations(specification), [specification]);
    const [selected, setSelected] = useState(operations[0] || null);
    const [search, setSearch] = useState('');
    const [request, setRequest] = useState(() => operations[0] ? createInitialRequest(operations[0], getServerUrl(specification)) : null);
    const [token, setToken] = useState(() => loadStoredValue(storageKeys.token));
    const [response, setResponse] = useState(null);
    const [requestError, setRequestError] = useState(null);
    const [sending, setSending] = useState(false);
    const [history, setHistory] = useState(loadHistory);
    const [sidebarOpen, setSidebarOpen] = useState(() => loadStoredValue(storageKeys.sidebar, 'open') !== 'closed');

    const filteredGroups = useMemo(() => {
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

        const grouped = filtered.reduce((result, operation) => {
            result[operation.tag] ??= [];
            result[operation.tag].push(operation);
            return result;
        }, {});

        return Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
    }, [operations, search]);

    const chooseOperation = (operation) => {
        setSelected(operation);
        setRequest(createInitialRequest(operation, request.baseUrl || getServerUrl(specification)));
        setResponse(null);
        setRequestError(null);
    };

    const saveToken = (value) => {
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

    const saveHistory = (item) => {
        const next = [item, ...history].slice(0, 20);
        setHistory(next);
        try {
            localStorage.setItem(storageKeys.history, JSON.stringify(next));
        } catch {
            // Keep history in memory when storage is unavailable.
        }
    };

    const createHistoryItem = (status) => ({
        id: crypto.randomUUID(),
        operationId: selected.id,
        method: selected.method,
        path: selected.path,
        status,
        createdAt: Date.now(),
        request: structuredClone(request),
        token,
    });

    const restoreHistoryItem = (item) => {
        const operation = operations.find((candidate) => candidate.id === item.operationId);
        if (!operation) return;

        setSelected(operation);
        setRequest(item.request
            ? structuredClone(item.request)
            : createInitialRequest(operation, request.baseUrl || getServerUrl(specification)));
        if (typeof item.token === 'string') {
            saveToken(item.token);
        }
        setResponse(null);
        setRequestError(null);
    };

    const sendRequest = async () => {
        setSending(true);
        setRequestError(null);
        setResponse(null);

        try {
            const prepared = buildRequest(selected, request, token);
            const startedAt = performance.now();
            const result = await fetch(prepared.url, prepared.options);
            const rawBody = await result.text();
            const duration = Math.round(performance.now() - startedAt);
            const parsedBody = parseResponseBody(rawBody, result.headers.get('content-type'));
            const responseData = {
                ok: result.ok,
                status: result.status,
                statusText: result.statusText,
                duration,
                size: `${new Blob([rawBody]).size.toLocaleString('id-ID')} B`,
                headers: getResponseHeaders(result.headers),
                body: parsedBody.text,
                json: parsedBody.json,
            };

            setResponse(responseData);
            saveHistory(createHistoryItem(result.status));
        } catch (error) {
            setRequestError(error.message);
            saveHistory(createHistoryItem(null));
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
                                    aria-label="Buka sidebar"
                                    aria-expanded="false"
                                >
                                    ☰
                                </button>
                                <span className="topbar__dot" />
                                <strong>{specification.info?.title || 'API'}</strong>
                                <span>v{specification.info?.version || specification.openapi}</span>
                            </>
                        )}
                    </div>
                    <HistoryDrawer
                        history={history}
                        onSelect={restoreHistoryItem}
                        onClear={() => {
                            setHistory([]);
                            localStorage.removeItem(storageKeys.history);
                        }}
                    />
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
                        />
                    ) : (
                        <div className="panel" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                            <h2>Tidak ada endpoint yang dipilih</h2>
                            <p>Silakan buat route API di Laravel atau pilih endpoint dari sidebar.</p>
                        </div>
                    )}
                    <ResponsePanel response={response} error={requestError} />
                </div>
            </section>
        </main>
    );
}

function ApiDocumentation() {
    const [specification, setSpecification] = useState(null);
    const [error, setError] = useState(null);

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
                    <h1>Dokumentasi tidak dapat dimuat</h1>
                    <span>{error}</span>
                    <button type="button" onClick={() => window.location.reload()}>Muat ulang</button>
                </section>
            </main>
        );
    }

    if (!specification) {
        return (
            <main className="docs-loading">
                <p>
                    <strong className="loading-text">Sedang Menyiapkan</strong>
                    <span className="loading-dots" aria-hidden="true">
                        <i>.</i><i>.</i><i>.</i>
                    </span>
                </p>
            </main>
        );
    }

    return <ApiWorkspace specification={specification} />;
}

createRoot(document.getElementById('docs-root')).render(
    <React.StrictMode>
        <ApiDocumentation />
    </React.StrictMode>,
);
