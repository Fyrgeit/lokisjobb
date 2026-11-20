export async function parseJsonResponse(response) {
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Servern returnerade ett ogiltigt svar (${response.status} ${response.statusText}): ${text.slice(0, 150)}`,
        );
    }
    if (!response.ok) {
        throw new Error(
            data.error ||
                data.message ||
                `HTTP-fel ${response.status} ${response.statusText}`,
        );
    }
    return data;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
