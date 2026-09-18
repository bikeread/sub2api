export const FINGERPRINT_MODELS = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
];

export type ReasoningEffort = string;
export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭 · none',
  minimal: '最低 · minimal',
  low: '低 · low',
  medium: '中 · medium',
  high: '高 · high',
  xhigh: '超高 · xhigh',
  max: '最高 · max',
  ultra: '极限 · ultra',
};
export function reasoningLabel(effort: string): string {
  return Object.hasOwn(REASONING_LABELS, effort)
    ? REASONING_LABELS[effort]
    : effort;
}

export interface ModelOption {
  id: string;
  reasoningEfforts: ReasoningEffort[];
}
export interface ModelCatalog {
  models: ModelOption[];
  source: 'account' | 'missing';
}
export interface AccountModelExtra {
  upstream_model_metadata?: {
    models?: Record<
      string,
      { reasoning?: boolean; supported_reasoning_levels?: string[] }
    >;
  };
}
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === 'string' && value.length > 0 && value.trim() === value
  );
}

/** Project only model capabilities; never send account credentials or other extra fields to the board. */
export function getModelCatalog(extra?: AccountModelExtra): ModelCatalog {
  const metadata = extra?.upstream_model_metadata?.models;
  const ids =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? Object.keys(metadata).filter((id) => id.trim())
      : [];
  const source = ids.length ? 'account' : 'missing';
  return {
    source,
    models: ids.map((id) => {
      const capability = metadata?.[id];
      const levels = capability?.supported_reasoning_levels;
      return {
        id,
        reasoningEfforts:
          capability?.reasoning === false
            ? []
            : Array.isArray(levels)
              ? [...new Set(levels.filter(isReasoningEffort))]
              : [],
      };
    }),
  };
}

export function selectableModels(
  catalog: ModelCatalog,
  method: 'fingerprint' | 'prompt',
): ModelOption[] {
  return method === 'prompt'
    ? catalog.models
    : catalog.models.filter((model) => FINGERPRINT_MODELS.includes(model.id));
}

export function automaticModel(models: ModelOption[]): string {
  return (
    FINGERPRINT_MODELS.find((id) => models.some((model) => model.id === id)) ??
    ''
  );
}

export function reasoningOptions(
  models: ModelOption[],
  model: string,
): ReasoningEffort[] {
  return models.find((option) => option.id === model)?.reasoningEfforts ?? [];
}

/** Keep the displayed selection and the submitted batch consistent after model/catalog changes. */
export function resolveSelection(
  catalog: ModelCatalog,
  method: 'fingerprint' | 'prompt',
  model = '',
  effort = '',
) {
  const models = selectableModels(catalog, method);
  const selectedModel = models.some((option) => option.id === model)
    ? model
    : '';
  const resolvedModel =
    selectedModel || (method === 'fingerprint' ? automaticModel(models) : '');
  const efforts = reasoningOptions(models, resolvedModel);
  return {
    models,
    model: selectedModel,
    resolvedModel,
    efforts,
    effort: efforts.find((value) => value === effort) ?? '',
  };
}
