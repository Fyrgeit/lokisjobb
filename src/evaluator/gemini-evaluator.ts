import type { AiCategory, Job } from '../types/job.js';

export interface EvaluationResult {
    category: AiCategory;
}

const aiCategories: ReadonlySet<string> = new Set<AiCategory>([
    'Persontåg',
    'Godståg',
    'Växlare',
    'Intressant',
    'Ointressant',
]);

function isAiCategory(value: unknown): value is AiCategory {
    return typeof value === 'string' && aiCategories.has(value);
}

export async function evaluateJobWithGemini(
    job: Job,
    apiKey: string,
    model = 'google/gemini-3.5-flash-lite',
): Promise<EvaluationResult> {
    const modelName = model.includes('/') ? model.split('/')[1] : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const prompt = `Du är expert på att klassificera jobbannonser inom järnväg.

Klassificera jobbannonsen i exakt en av följande kategorier:
- "Persontåg": arbetet går huvudsakligen ut på att köra persontåg. Roslagsbanans förare klassas här.
- "Godståg": arbetet går huvudsakligen ut på att köra godståg, inklusive arbets- och transporttåg för banarbeten.
- "Växlare": arbetet går huvudsakligen ut på växling, rangering eller tågbildning.
- "Intressant": annan intressant roll med direkt koppling till tågtrafiken, till exempel tunnelbane- eller spårvagnsförare, tågvärd/tågmästare, trafikledning eller tågklarering. Tunnelbane- och spårvagnsförare ska alltid placeras här, inte i "Persontåg".
- "Ointressant": jobbet saknar tydlig koppling till järnväg eller tågtrafik. Vägtransport, lastbilsjobb och "lastväxlare" för lastbil hör hit. Välj även denna kategori om en utvärderad annons saknar tillräcklig information för att fastställa en relevant järnvägsroll.

Välj kategorin efter arbetsuppgifterna, inte enbart arbetsgivaren eller jobbtiteln. "Okänd" används endast i appen för jobb som ännu inte har utvärderats och ska inte returneras av dig.

Jobbtitel: ${job.title}
Företag: ${job.company ?? 'Okänt'}
Plats: ${job.location ?? 'Okänd'}
Beskrivning: ${job.description ?? 'Ingen beskrivning tillgänglig'}

Svara med endast ett JSON-objekt som innehåller kategorin. Lägg inte till någon förklaring eller andra fält:
{
  "category": "Persontåg"
}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [{ text: prompt }],
                },
            ],
            generationConfig: {
                responseMimeType: 'application/json',
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string }>;
            };
        }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Empty response from Gemini API');
    }

    const parsed: unknown = JSON.parse(text);
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Object.keys(parsed).length !== 1 ||
        !('category' in parsed) ||
        !isAiCategory(parsed.category)
    ) {
        throw new Error('Invalid category from Gemini API');
    }

    return { category: parsed.category };
}
