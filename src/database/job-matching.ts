export interface JobMatchDetails {
    title: string;
    company: string | null;
    location: string | null;
    canonicalUrl?: string | null;
    applicationDeadline: string | null;
    description: string | null;
}

function normalizeText(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase('sv-SE')
        .replace(/[^\p{L}\p{N}]/gu, '');
}

function characterTrigrams(value: string): Set<string> {
    const trigrams = new Set<string>();
    for (let index = 0; index <= value.length - 3; index += 1) {
        trigrams.add(value.slice(index, index + 3));
    }
    return trigrams;
}

function descriptionSimilarity(first: string, second: string): number {
    const firstTrigrams = characterTrigrams(normalizeText(first));
    const secondTrigrams = characterTrigrams(normalizeText(second));
    if (firstTrigrams.size === 0 || secondTrigrams.size === 0) {
        return 0;
    }

    let sharedTrigrams = 0;
    for (const trigram of firstTrigrams) {
        if (secondTrigrams.has(trigram)) {
            sharedTrigrams += 1;
        }
    }

    return (2 * sharedTrigrams) / (firstTrigrams.size + secondTrigrams.size);
}

export function isLikelySamePosting(
    first: JobMatchDetails,
    second: JobMatchDetails,
): boolean {
    if (
        !first.company ||
        !second.company ||
        (first.canonicalUrl &&
            second.canonicalUrl &&
            first.canonicalUrl !== second.canonicalUrl) ||
        !first.applicationDeadline ||
        first.applicationDeadline !== second.applicationDeadline ||
        normalizeText(first.title) !== normalizeText(second.title) ||
        normalizeText(first.company) !== normalizeText(second.company)
    ) {
        return false;
    }

    if (!first.description || !second.description) {
        return (
            !!first.location &&
            !!second.location &&
            normalizeText(first.location) === normalizeText(second.location)
        );
    }

    const firstDescription = normalizeText(first.description);
    const secondDescription = normalizeText(second.description);
    return (
        firstDescription.length >= 120 &&
        secondDescription.length >= 120 &&
        descriptionSimilarity(first.description, second.description) >= 0.92
    );
}
