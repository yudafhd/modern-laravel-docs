export interface RequestRow {
    id: string;
    name: string;
    value: string;
    example: string;
    enabled: boolean;
    required: boolean;
    locked: boolean;
}

export interface FileRow {
    id: string;
    name: string;
    file: File | null;
    enabled: boolean;
    required: boolean;
    locked: boolean;
}

export interface Operation {
    id: string;
    method: string;
    path: string;
    tag: string;
    summary: string;
    description: string;
    operationId: string;
    parameters: any[];
    requestBody: any;
    contentTypes: string[];
    bodyExamples: Record<string, any>;
    responses?: any;
    specification: any;
}

export interface RequestState {
    baseUrl: string;
    path: RequestRow[];
    query: RequestRow[];
    headers: RequestRow[];
    authType: string;
    contentType: string;
    body: string;
    files: FileRow[];
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyPlacement?: 'header' | 'query';
}

const supportedMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

export function resolveReference(specification: any, value: any): any {
    if (!value?.$ref?.startsWith('#/')) return value;

    return value.$ref
        .slice(2)
        .split('/')
        .reduce((current: any, segment: string) => current?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')], specification);
}

export function resolveSchema(specification: any, schema: any, depth = 0): any {
    if (!schema || depth > 8) return schema;
    const resolved = resolveReference(specification, schema);

    if (resolved?.allOf) {
        return resolved.allOf.reduce((result: any, item: any) => {
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

function schemaExample(specification: any, schema: any, depth = 0): any {
    const resolved = resolveSchema(specification, schema, depth);
    if (!resolved || depth > 6) return null;
    if (resolved.example !== undefined) return resolved.example;
    if (resolved.default !== undefined) return resolved.default;
    if (resolved.examples?.length) return resolved.examples[0];
    if (resolved.enum?.length) return resolved.enum[0];

    const type = Array.isArray(resolved.type)
        ? resolved.type.find((item: any) => item !== 'null')
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

function makeParameterRow(parameter: any, specification: any): RequestRow {
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

export function getOperations(specification: any): Operation[] {
    const operations: Operation[] = [];

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
                        ?? (Object.values(media.examples ?? {}) as any)[0]?.value
                        ?? schemaExample(specification, media.schema);
                    return [contentType, example];
                })),
                responses: operation.responses,
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

export function getServerUrl(specification: any): string {
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

export function createInitialRequest(operation: Operation, baseUrl: string): RequestState {
    const parameters = operation.parameters.map((parameter) => {
        const resolved = resolveReference(operation.specification, parameter);
        return { location: resolved?.in, row: makeParameterRow(parameter, operation.specification) };
    });
    const contentType = operation.contentTypes.includes('application/json')
        ? 'application/json'
        : operation.contentTypes[0] ?? 'application/json';

    // Auto-detect files for multipart/form-data
    const files: FileRow[] = [];
    if (contentType === 'multipart/form-data' && operation.requestBody) {
        const content = operation.requestBody.content ?? {};
        const media = content['multipart/form-data'];
        if (media && media.schema) {
            const schema = resolveSchema(operation.specification, media.schema);
            if (schema && schema.properties) {
                Object.entries(schema.properties).forEach(([name, property]: [string, any]) => {
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

function parseObjectBody(body: string, label: string): Record<string, any> {
    try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error();
        }
        return parsed;
    } catch {
        throw new Error(`${label} must be a valid JSON object.`);
    }
}

export function replaceEnvVariables(text: string, env: Record<string, string>): string {
    if (!text) return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const trimmed = key.trim();
        return env[trimmed] !== undefined ? env[trimmed] : `{{${key}}}`;
    });
}

function getCookie(name: string): string | undefined {
    return document.cookie
        .split('; ')
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

export function buildRequest(
    operation: Operation,
    request: RequestState,
    token: string,
    env: Record<string, string> = {}
): { url: string; options: RequestInit } {
    const missingPath = request.path.find((row) => row.required && !row.value);
    if (missingPath) throw new Error(`Path variable "${missingPath.name}" is required.`);
    const missingQuery = request.query.find((row) => row.required && (!row.enabled || !row.value));
    if (missingQuery) throw new Error(`Query parameter "${missingQuery.name}" is required.`);

    let path = operation.path;
    request.path.filter((row) => row.enabled).forEach((row) => {
        const resolvedValue = replaceEnvVariables(row.value, env);
        path = path.replace(`{${row.name}}`, encodeURIComponent(resolvedValue));
    });

    const baseUrl = replaceEnvVariables(request.baseUrl, env).replace(/\/$/, '');
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    request.query.filter((row) => row.enabled && row.name).forEach((row) => {
        const resolvedName = replaceEnvVariables(row.name, env);
        const resolvedValue = replaceEnvVariables(row.value, env);
        url.searchParams.append(resolvedName, resolvedValue);
    });

    const headers = new Headers({ Accept: 'application/json' });
    request.headers.filter((row) => row.enabled && row.name).forEach((row) => {
        const resolvedName = replaceEnvVariables(row.name, env);
        const resolvedValue = replaceEnvVariables(row.value, env);
        headers.set(resolvedName, resolvedValue);
    });

    if (request.authType === 'bearer' && token.trim()) {
        const resolvedToken = replaceEnvVariables(token.trim(), env);
        headers.set('Authorization', resolvedToken.toLowerCase().startsWith('bearer ') ? resolvedToken : `Bearer ${resolvedToken}`);
    } else if (request.authType === 'basic') {
        const u = replaceEnvVariables(request.basicAuthUsername || '', env);
        const p = replaceEnvVariables(request.basicAuthPassword || '', env);
        let credentials = '';
        try {
            credentials = btoa(unescape(encodeURIComponent(`${u}:${p}`)));
        } catch {
            credentials = btoa(`${u}:${p}`);
        }
        headers.set('Authorization', `Basic ${credentials}`);
    } else if (request.authType === 'apikey' && request.apiKeyName) {
        const name = replaceEnvVariables(request.apiKeyName, env);
        const val = replaceEnvVariables(request.apiKeyValue || '', env);
        if (request.apiKeyPlacement === 'query') {
            url.searchParams.append(name, val);
        } else {
            headers.set(name, val);
        }
    }

    const xsrfToken = getCookie('XSRF-TOKEN');
    if (xsrfToken) {
        headers.set('X-XSRF-TOKEN', decodeURIComponent(xsrfToken));
    }

    const options: RequestInit = {
        method: operation.method,
        headers,
        credentials: 'include',
    };

    if (!['GET', 'HEAD'].includes(operation.method)) {
        const resolvedBody = replaceEnvVariables(request.body, env);
        if (request.contentType === 'multipart/form-data') {
            const data = new FormData();
            if (resolvedBody.trim()) {
                Object.entries(parseObjectBody(resolvedBody, 'Multipart body')).forEach(([name, value]) => {
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
        } else if (request.contentType === 'application/x-www-form-urlencoded' && resolvedBody.trim()) {
            const data = new URLSearchParams();
            Object.entries(parseObjectBody(resolvedBody, 'Form body')).forEach(([name, value]) => {
                data.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
            });
            headers.set('Content-Type', request.contentType);
            options.body = data;
        } else {
            headers.set('Content-Type', request.contentType);
            if (request.contentType.includes('json') && resolvedBody.trim()) JSON.parse(resolvedBody);
            options.body = resolvedBody;
        }
    }

    return { url: url.toString(), options };
}

export function formatBody(value: string): string {
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

export function parseResponseBody(value: string, contentType: string = ''): { text: string; json: any } {
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

export function getResponseHeaders(headers: Headers): [string, string][] {
    return [...headers.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function generateSnippet(language: string, url: string, options: any, contentType: string): string {
    const method = options.method || 'GET';
    const headersObj: Record<string, string> = {};
    if (options.headers) {
        options.headers.forEach((value: string, key: string) => {
            headersObj[key] = value;
        });
    }

    let bodyStr = '';
    let isJson = contentType.includes('json');

    if (options.body) {
        if (options.body instanceof FormData) {
            bodyStr = '[FormData]';
        } else if (options.body instanceof URLSearchParams) {
            bodyStr = options.body.toString();
        } else {
            bodyStr = String(options.body);
        }
    }

    switch (language) {
        case 'curl': {
            const headersPart = Object.entries(headersObj)
                .map(([key, value]) => `  -H "${key}: ${value}"`)
                .join(' \\\n');
            let bodyPart = '';
            if (options.body) {
                if (options.body instanceof FormData) {
                    bodyPart = ' \\\n  # Form data fields (binary / upload files)';
                } else {
                    bodyPart = ` \\\n  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
                }
            }
            return `curl -X ${method} "${url}"${headersPart ? ' \\\n' + headersPart : ''}${bodyPart}`;
        }
        case 'javascript': {
            const headersStr = JSON.stringify(headersObj, null, 4);
            let bodyPart = '';
            if (options.body) {
                if (options.body instanceof FormData) {
                    bodyPart = ',\n    body: formData // Append your files and fields';
                } else if (isJson) {
                    bodyPart = `,\n    body: JSON.stringify(${bodyStr})`;
                } else {
                    bodyPart = `,\n    body: ${JSON.stringify(bodyStr)}`;
                }
            }
            return `fetch("${url}", {
    method: "${method}",
    headers: ${headersStr}${bodyPart}
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error(error));`;
        }
        case 'python': {
            const headersStr = JSON.stringify(headersObj, null, 4);
            let bodyPart = '';
            if (options.body) {
                if (options.body instanceof FormData) {
                    bodyPart = ',\n    files=files # define your files dict';
                } else if (isJson) {
                    bodyPart = `,\n    json=${bodyStr}`;
                } else {
                    bodyPart = `,\n    data=${JSON.stringify(bodyStr)}`;
                }
            }
            return `import requests

url = "${url}"
headers = ${headersStr}

response = requests.request("${method}", url, headers=headers${bodyPart})
print(response.status_code)
print(response.text)`;
        }
        case 'php': {
            const headersPart = Object.entries(headersObj)
                .map(([key, value]) => `        '${key}' => '${value}'`)
                .join(',\n');
            let bodyPart = '';
            if (options.body) {
                if (options.body instanceof FormData) {
                    bodyPart = `,\n    'multipart' => [ /* your file array */ ]`;
                } else if (isJson) {
                    bodyPart = `,\n    'json' => json_decode('${bodyStr.replace(/'/g, "\\'")}', true)`;
                } else {
                    bodyPart = `,\n    'body' => '${bodyStr.replace(/'/g, "\\'")}'`;
                }
            }
            return `$client = new \\GuzzleHttp\\Client();

$response = $client->request('${method}', '${url}', [
    'headers' => [
${headersPart}
    ]${bodyPart}
]);

echo $response->getBody();`;
        }
        default:
            return '';
    }
}
