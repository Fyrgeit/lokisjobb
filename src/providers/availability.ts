import type { SourceAvailability } from '../types/job.js';

export function providerFetchHeaders(
    accept = 'text/html',
): Record<string, string> {
    return {
        Accept: accept,
        'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
    };
}

export async function fetchProviderHtml(
    fetchImpl: typeof fetch,
    url: URL,
    providerLabel: string,
): Promise<string> {
    const response = await fetchImpl(url, {
        headers: providerFetchHeaders(),
    });
    if (!response.ok) {
        throw new Error(
            `Begäran till ${providerLabel} misslyckades med HTTP ${response.status}`,
        );
    }
    return response.text();
}

export async function fetchProviderJson(
    fetchImpl: typeof fetch,
    url: URL,
    providerLabel: string,
): Promise<unknown> {
    const response = await fetchImpl(url, {
        headers: providerFetchHeaders('application/json'),
    });
    if (!response.ok) {
        throw new Error(
            `Begäran till ${providerLabel} misslyckades med HTTP ${response.status}`,
        );
    }
    return response.json();
}

const closedPagePattern =
    /does not exist|not found|no longer available|verkar inte finnas kvar|finns inte kvar|annonsen.*borttagen/i;

export function availabilityFromResponse(
    status: number,
    body = '',
): SourceAvailability {
    if (status === 404 || status === 410 || closedPagePattern.test(body)) {
        return 'closed';
    }

    return status >= 200 && status < 300 ? 'active' : 'unknown';
}

export async function checkApplicationAvailability(
    fetchImpl: typeof fetch,
    url: string,
): Promise<SourceAvailability> {
    if (url.startsWith('mailto:')) {
        return 'active';
    }

    try {
        const response = await fetchImpl(url, {
            headers: providerFetchHeaders(),
        });
        return availabilityFromResponse(response.status, await response.text());
    } catch {
        return 'unknown';
    }
}
