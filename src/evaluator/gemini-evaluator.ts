import type { Job } from '../types/job.js';

export interface EvaluationResult {
    score: number; // 0.0 to 1.0
    reasoning: string;
}

export async function evaluateJobWithGemini(
    job: Job,
    apiKey: string,
    model = 'google/gemini-3.5-flash-lite',
): Promise<EvaluationResult> {
    const modelName = model.includes('/') ? model.split('/')[1] : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const prompt = `Du är en expert på arbetsmarknaden inom järnväg och transport (såsom lokförare, växlare, tågmästare, etc.).
Utvärdera följande jobbannons och sätt ett relevansbetyg mellan 0.0 och 1.0 (där 1.0 är extremt relevant, 0.5 är måttligt relevant/närliggande, och 0.0 är helt irrelevant).

STRIKT KRAV: Jobbet måste kräva eller utnyttja ett giltigt lokförarbevis för att vara relevant. 
Om jobbet handlar om t.ex. "Lastväxlare CE" (lastbilschaufför med lastväxlare) eller andra roller inom lastbil/vägtransport som inte har med tåg/järnväg att göra och inte kräver lokförarbevis, ska det omedelbart ges betyget 0.0.

Jobbtitel: ${job.title}
Företag: ${job.company ?? 'Okänt'}
Plats: ${job.location ?? 'Okänd'}
Beskrivning: ${job.description ?? 'Ingen beskrivning tillgänglig'}

Svara strikt med ett JSON-objekt i exakt detta format:
{
  "score": 0.85,
  "reasoning": "Kort motivering på svenska varför jobbet är relevant eller irrelevant utifrån lokförarbevis."
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

    const parsed = JSON.parse(text) as { score?: number; reasoning?: string };
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Ingen motivering angiven';

    return { score, reasoning };
}
