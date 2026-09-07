import type { SourceAvailability } from '../types/job.js';

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
            headers: {
                Accept: 'text/html',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });
        return availabilityFromResponse(response.status, await response.text());
    } catch {
        return 'unknown';
    }
}
