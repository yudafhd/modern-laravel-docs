const supportedMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function resolveReference(specification, value) {
    if (!value?.$ref?.startsWith('#/')) return value;

    return value.$ref
        .slice(2)
        .split('/')
        .reduce((current, segment) => current?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')], specification);
}

function resolveSchema(specification, schema, depth = 0) {
    if (!schema || depth > 8) return schema;
    const resolved = resolveReference(specification, schema);

    if (resolved?.allOf) {
        return resolved.allOf.reduce((result, item) => {
            const part = resolveSchema(specification, item, depth + 1);
            return {
                ...result,
                ...part,
                properties: { ...result.properties, ...part?.properties },
                required: [...new Set([...(result.required ?? []), ...(part?.required ?? [])])],
            };
        }, {});
    }

    return resolved;
}

function schemaExample(specification, schema, depth = 0) {
    const resolved = resolveSchema(specification, schema, depth);
    if (!resolved || depth > 6) return null;
    if (resolved.example !== undefined) return resolved.example;
    if (resolved.default !== undefined) return resolved.default;
    if (resolved.examples?.length) return resolved.examples[0];
    if (resolved.enum?.length) return resolved.enum[0];

    const type = Array.isArray(resolved.type)
        ? resolved.type.find((item) => item !== 'null')
        : resolved.type;

    if (type === 'object' || resolved.properties) {
        return Object.fromEntries(
            Object.entries(resolved.properties ?? {}).map(([name, property]) => [
                name,
                schemaExample(specification, property, depth + 1),
            ]),
        );
    }
    if (type === 'array') return [schemaExample(specification, resolved.items, depth + 1)];
    if (type === 'integer' || type === 'number') return resolved.minimum ?? 0;
    if (type === 'boolean') return false;
    if (resolved.format === 'date') return new Date().toISOString().slice(0, 10);
    if (resolved.format === 'date-time') return new Date().toISOString();
    if (resolved.format === 'email') return 'user@example.com';
    if (resolved.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
    return '';
}

function makeParameterRow(parameter, specification) {
    const resolved = resolveReference(specification, parameter);
    const schema = resolveSchema(specification, resolved?.schema);
    const example = resolved?.example
        ?? schema?.example
        ?? schema?.default
        ?? (schema?.enum?.[0] ?? '');

    return {
        id: crypto.randomUUID(),
        name: resolved?.name ?? '',
        value: example === null || example === undefined
            ? ''
            : typeof example === 'object' ? JSON.stringify(example) : String(example),
        example: resolved?.description || '',
        enabled: Boolean(resolved?.required || example !== ''),
        required: Boolean(resolved?.required),
        locked: true,
    };
}

export function getOperations(specification) {
    const operations = [];

    Object.entries(specification.paths ?? {}).forEach(([path, pathItemValue]) => {
        const pathItem = resolveReference(specification, pathItemValue);

        supportedMethods.forEach((method) => {
            if (!pathItem?.[method]) return;
            const operation = pathItem[method];
            const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
            const requestBody = resolveReference(specification, operation.requestBody);
            const content = requestBody?.content ?? {};
            const contentTypes = Object.keys(content);

            operations.push({
                id: operation.operationId || `${method}:${path}`,
                method: method.toUpperCase(),
                path,
                tag: operation.tags?.[0] || 'General',
                summary: operation.summary || operation.operationId || '',
                description: operation.description || '',
                operationId: operation.operationId || '',
                parameters,
                requestBody,
                contentTypes,
                bodyExamples: Object.fromEntries(contentTypes.map((contentType) => {
                    const media = content[contentType];
                    const example = media.example
                        ?? Object.values(media.examples ?? {})[0]?.value
                        ?? schemaExample(specification, media.schema);
                    return [contentType, example];
                })),
                specification,
            });
        });
    });

    return operations.sort((left, right) => {
        const tag = left.tag.localeCompare(right.tag);
        if (tag !== 0) return tag;
        const path = left.path.localeCompare(right.path);
        if (path !== 0) return path;
        return supportedMethods.indexOf(left.method.toLowerCase()) - supportedMethods.indexOf(right.method.toLowerCase());
    });
}

export function getServerUrl(specification) {
    const configured = specification.servers?.[0]?.url;
    if (!configured) return `${window.location.origin}/api`;

    try {
        const url = new URL(configured, window.location.origin);
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
            return `${window.location.origin}${url.pathname.replace(/\/$/, '')}`;
        }
        return url.toString().replace(/\/$/, '');
    } catch {
        return configured.replace(/\/$/, '');
    }
}

export function createInitialRequest(operation, baseUrl) {
    const parameters = operation.parameters.map((parameter) => {
        const resolved = resolveReference(operation.specification, parameter);
        return { location: resolved?.in, row: makeParameterRow(parameter, operation.specification) };
    });
    const contentType = operation.contentTypes.includes('application/json')
        ? 'application/json'
        : operation.contentTypes[0] ?? 'application/json';

    // Auto-detect files for multipart/form-data
    const files = [];
    if (contentType === 'multipart/form-data' && operation.requestBody) {
        const content = operation.requestBody.content ?? {};
        const media = content['multipart/form-data'];
        if (media && media.schema) {
            const schema = resolveSchema(operation.specification, media.schema);
            if (schema && schema.properties) {
                Object.entries(schema.properties).forEach(([name, property]) => {
                    const resolvedProp = resolveSchema(operation.specification, property);
                    if (resolvedProp && (resolvedProp.format === 'binary' || resolvedProp.type === 'file' || (resolvedProp.type === 'string' && resolvedProp.format === 'binary'))) {
                        files.push({
                            id: crypto.randomUUID(),
                            name,
                            file: null,
                            enabled: true,
                            required: schema.required?.includes(name) ?? false,
                            locked: true,
                        });
                    }
                });
            }
        }
    }

    const bodyExample = operation.bodyExamples[contentType];
    let body = '';
    if (bodyExample !== undefined && bodyExample !== null) {
        let cleanExample = structuredClone(bodyExample);
        if (contentType === 'multipart/form-data' && typeof cleanExample === 'object') {
            files.forEach((fileField) => {
                delete cleanExample[fileField.name];
            });
        }
        body = JSON.stringify(cleanExample, null, 2);
    }

    return {
        baseUrl,
        path: parameters.filter((item) => item.location === 'path').map((item) => item.row),
        query: parameters.filter((item) => item.location === 'query').map((item) => item.row),
        headers: parameters.filter((item) => item.location === 'header').map((item) => item.row),
        authType: 'bearer',
        contentType,
        body,
        files,
    };
}

function parseObjectBody(body, label) {
    try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error();
        }
        return parsed;
    } catch {
        throw new Error(`${label} harus berupa JSON object yang valid.`);
    }
}

function getCookie(name) {
    return document.cookie
        .split('; ')
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

export function buildRequest(operation, request, token) {
    const missingPath = request.path.find((row) => row.required && !row.value);
    if (missingPath) throw new Error(`Path variable "${missingPath.name}" wajib diisi.`);
    const missingQuery = request.query.find((row) => row.required && (!row.enabled || !row.value));
    if (missingQuery) throw new Error(`Query parameter "${missingQuery.name}" wajib diisi.`);

    let path = operation.path;
    request.path.filter((row) => row.enabled).forEach((row) => {
        path = path.replace(`{${row.name}}`, encodeURIComponent(row.value));
    });

    const baseUrl = request.baseUrl.replace(/\/$/, '');
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    request.query.filter((row) => row.enabled && row.name).forEach((row) => {
        url.searchParams.append(row.name, row.value);
    });

    const headers = new Headers({ Accept: 'application/json' });
    request.headers.filter((row) => row.enabled && row.name).forEach((row) => {
        headers.set(row.name, row.value);
    });
    if (request.authType === 'bearer' && token.trim()) {
        headers.set('Authorization', token.trim().toLowerCase().startsWith('bearer ') ? token.trim() : `Bearer ${token.trim()}`);
    }
    const xsrfToken = getCookie('XSRF-TOKEN');
    if (xsrfToken) {
        headers.set('X-XSRF-TOKEN', decodeURIComponent(xsrfToken));
    }

    const options = {
        method: operation.method,
        headers,
        credentials: 'include',
    };

    if (!['GET', 'HEAD'].includes(operation.method)) {
        if (request.contentType === 'multipart/form-data') {
            const data = new FormData();
            if (request.body.trim()) {
                Object.entries(parseObjectBody(request.body, 'Multipart body')).forEach(([name, value]) => {
                    data.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
                });
            }
            if (request.files && Array.isArray(request.files)) {
                request.files.forEach((row) => {
                    if (row.enabled && row.name && row.file) {
                        data.append(row.name, row.file);
                    }
                });
            }
            options.body = data;
        } else if (operation.requestBody && request.body.trim()) {
            const data = new URLSearchParams();
            Object.entries(parseObjectBody(request.body, 'Form body')).forEach(([name, value]) => {
                data.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
            });
            headers.set('Content-Type', request.contentType);
            options.body = data;
        } else {
            headers.set('Content-Type', request.contentType);
            if (request.contentType.includes('json')) JSON.parse(request.body);
            options.body = request.body;
        }
    }

    return { url: url.toString(), options };
}

export function formatBody(value) {
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

export function parseResponseBody(value, contentType = '') {
    if (!value) return { text: '(empty response)', json: null };
    if (contentType?.includes('json')) {
        try {
            const json = JSON.parse(value);
            return {
                text: JSON.stringify(json, null, 2),
                json,
            };
        } catch {
            return { text: value, json: null };
        }
    }

    return { text: value, json: null };
}

export function getResponseHeaders(headers) {
    return [...headers.entries()].sort(([left], [right]) => left.localeCompare(right));
}
