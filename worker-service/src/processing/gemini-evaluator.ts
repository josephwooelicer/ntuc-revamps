import axios from 'axios';
import { EvaluationLabel, MatrixScores, SHARED_MATRIX_VERSION, computeFinalScore } from './evaluation-matrix';

export type NewsEvalInput = {
    companyName: string;
    title: string;
    url: string;
    snippet: string;
    outlet: string;
};

export type NewsEvalOutput = {
    eventType: string;
    signalCategory: string;
    label: EvaluationLabel;
    summary: string;
    occurredAt: string | null;
    eventGroupKey: string;
    confidence: number;
    matrixScores: MatrixScores;
    finalScore: number;
    reasoning: string;
    model: string;
};

function normalizeLabel(input: string): EvaluationLabel {
    const val = (input || '').toLowerCase().trim();
    if (val === 'positive' || val === 'negative' || val === 'neutral' || val === 'irrelevant') {
        return val;
    }
    return 'neutral';
}

function normalizeScore(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(5, Math.round(value)));
}

export async function evaluateNewsWithGemini(input: NewsEvalInput): Promise<NewsEvalOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return {
            eventType: 'unknown',
            signalCategory: 'news_event',
            label: 'neutral',
            summary: `${input.title} (${input.outlet})`,
            occurredAt: null,
            eventGroupKey: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            confidence: 0.35,
            matrixScores: {
                distress_signal: 0,
                retrenchment_proximity: 0,
                impact_scope: 1,
                credibility: 2,
                timeliness: 2,
                relevance: 2,
                positive_offset: 0
            },
            finalScore: 0,
            reasoning: 'GEMINI_API_KEY not configured; fallback neutral evaluation applied.',
            model: 'fallback-no-key'
        };
    }

    const prompt = `
You are evaluating a COMPANY-LEVEL news signal for retrenchment early warning.
Company: ${input.companyName}
Title: ${input.title}
URL: ${input.url}
Snippet: ${input.snippet}
Outlet: ${input.outlet}

Return strict JSON only with fields:
{
  "eventType": "string",
  "signalCategory": "string",
  "label": "positive|neutral|negative|irrelevant",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key for grouping same event across outlets",
  "confidence": 0..1,
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}

Scoring guidance:
- Negative layoffs-related deterioration -> higher distress/retrenchment.
- Positive expansion/investment news -> higher positive_offset.
- Ads/PR or unrelated content -> label=irrelevant and relevance low.
- Use only evidence from title+snippet+url metadata.
`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await axios.post(endpoint, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
        }
    }, {
        timeout: 30000
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini response missing content');
    }
    const parsed = JSON.parse(text);
    const matrixScores: MatrixScores = {
        distress_signal: normalizeScore(parsed?.matrixScores?.distress_signal),
        retrenchment_proximity: normalizeScore(parsed?.matrixScores?.retrenchment_proximity),
        impact_scope: normalizeScore(parsed?.matrixScores?.impact_scope),
        credibility: normalizeScore(parsed?.matrixScores?.credibility),
        timeliness: normalizeScore(parsed?.matrixScores?.timeliness),
        relevance: normalizeScore(parsed?.matrixScores?.relevance),
        positive_offset: normalizeScore(parsed?.matrixScores?.positive_offset)
    };

    return {
        eventType: parsed?.eventType || 'unknown',
        signalCategory: parsed?.signalCategory || 'news_event',
        label: normalizeLabel(parsed?.label),
        summary: parsed?.summary || `${input.title} (${input.outlet})`,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}
