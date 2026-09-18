import type { ReasoningEffort } from './options';

// Port of xqy2006/ModelTrace fingerprint math (MIT, see data/MODELTRACE-LICENSE).
export interface BankModel {
  id: string;
  display_name: string;
  family?: string;
  family_name?: string;
  counts: number[];
}

export interface HellingerArtifact {
  feature_mean: number[];
  feature_scale: number[];
  nuisance_basis: number[][];
  centroids: number[][];
}

export interface OrderedBlocksArtifact {
  weight: number;
  feature_mean: number[];
  feature_scale: number[];
  nuisance_basis: number[][];
  centroids: number[][];
  environment_centroids: number[][][];
}

export interface ModelTraceBank {
  models: BankModel[];
  robust: {
    model_order: string[];
    hellinger: HellingerArtifact;
    ordered_blocks?: OrderedBlocksArtifact;
  };
  calibration: Record<string, { beta: number; cv_accuracy: number }>;
  method?: { name?: string };
}

export interface Challenge {
  id: string;
  expectedCount: number;
  prompt: string;
}

export interface ChallengeAnswer {
  text: string;
  expectedCount: number;
}

export interface ModelScore {
  model: string;
  displayName: string;
  probability: number;
  profileSimilarity: number;
  score: number;
  nuisanceScore: number;
  family: string;
  familyName: string;
  conditionalProbability: number;
}

export interface AnswerDiagnostic {
  index: number;
  parsedNumbers: number;
  minimumNumbers: number;
  accepted: boolean;
}

export interface AttributionResult {
  prediction: string;
  predictionName: string;
  probability: number;
  usedOutputs: number;
  results: ModelScore[];
  diagnostics: AnswerDiagnostic[];
  calibration: { queries: string; beta: number; cvAccuracy: number };
  familyPrediction: string;
  familyPredictionName: string;
  familyProbability: number;
}

export type Verdict = 'ok' | 'suspected_downgrade' | 'inconclusive';

export interface DetectionVerdict {
  verdict: Verdict;
  reason: string;
}

export interface AttributionDetail {
  top: { model: string; displayName: string; probability: number }[];
  usedOutputs: number;
  diagnostics: AnswerDiagnostic[];
  familyProbability: number;
}

interface HistoryBase {
  accountId: number;
  accountName: string;
  model: string;
  detectedAt: string;
  durationMs?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface FingerprintHistoryEntry extends HistoryBase {
  method?: 'fingerprint'; // Old JSONL entries have no method.
  verdict: Verdict;
  reason: string;
  prediction: string;
  probability: number;
  top: { model: string; probability: number }[];
  usedOutputs: number;
  attribution?: AttributionDetail;
}

export interface PromptHistoryEntry extends HistoryBase {
  method: 'prompt';
  prompt: string;
  output: string;
  finishReason: string | null;
}

export type HistoryEntry = FingerprintHistoryEntry | PromptHistoryEntry;
export type DetectionOutcome =
  | { entry: FingerprintHistoryEntry; attribution: AttributionDetail }
  | { entry: PromptHistoryEntry };
