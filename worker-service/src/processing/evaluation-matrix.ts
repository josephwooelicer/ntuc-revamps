export type EvaluationLabel = 'positive' | 'neutral' | 'negative' | 'irrelevant';

export type MatrixScores = {
    distress_signal: number; // 0..5
    retrenchment_proximity: number; // 0..5
    impact_scope: number; // 0..5
    credibility: number; // 0..5
    timeliness: number; // 0..5
    relevance: number; // 0..5
    positive_offset: number; // 0..5
};

export const SHARED_MATRIX_VERSION = 'v1.0';

// Shared weighting so all sources are scored on one comparable scale.
export const SHARED_MATRIX_WEIGHTS = {
    distress_signal: 0.26,
    retrenchment_proximity: 0.24,
    impact_scope: 0.15,
    credibility: 0.12,
    timeliness: 0.10,
    relevance: 0.13,
    positive_offset: 0.22
} as const;

export function clampScore(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function computeFinalScore(scores: MatrixScores): number {
    const negative =
        scores.distress_signal * SHARED_MATRIX_WEIGHTS.distress_signal +
        scores.retrenchment_proximity * SHARED_MATRIX_WEIGHTS.retrenchment_proximity +
        scores.impact_scope * SHARED_MATRIX_WEIGHTS.impact_scope +
        scores.credibility * SHARED_MATRIX_WEIGHTS.credibility +
        scores.timeliness * SHARED_MATRIX_WEIGHTS.timeliness +
        scores.relevance * SHARED_MATRIX_WEIGHTS.relevance;

    const positiveRelief = scores.positive_offset * SHARED_MATRIX_WEIGHTS.positive_offset;
    const fivePointScale = clampScore(negative - positiveRelief, 0, 5);
    return Math.round((fivePointScale / 5) * 100);
}
