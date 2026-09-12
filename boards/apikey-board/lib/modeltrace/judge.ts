import type { AttributionResult, DetectionVerdict } from './types';

const SUSPECT_PROBABILITY_THRESHOLD = 0.5;

/**
 * claimedModel 是请求里声明的模型（如 gpt-6-astra）。
 * top1 归因不一致且达到阈值，或归因到了别的模型家族，判疑似降级。
 * 单条有效回答（校准 cv 准确率约 95.5%）同样给出判定，但标注建议复测。
 */
export function judgeAttribution(
  attribution: AttributionResult,
  claimedModel: string,
): DetectionVerdict {
  if (attribution.usedOutputs < 1) {
    return { verdict: 'inconclusive', reason: '无有效回答，无法判定' };
  }
  const top = attribution.results[0];
  if (!top) {
    return { verdict: 'inconclusive', reason: '归因结果为空' };
  }
  const lowConfidenceNote =
    attribution.usedOutputs === 1 ? '（仅 1 条有效回答，建议复测确认）' : '';
  const claimed = attribution.results.find((r) => r.model === claimedModel);
  if (top.model === claimedModel) {
    return {
      verdict: 'ok',
      reason: `归因命中声明模型（P=${top.probability.toFixed(2)}）${lowConfidenceNote}`,
    };
  }
  if (claimed && top.family !== claimed.family) {
    return {
      verdict: 'suspected_downgrade',
      reason: `疑似降级：声明 ${claimedModel}，实际归因到 ${top.model}（${top.familyName} 家族，P=${top.probability.toFixed(2)}）${lowConfidenceNote}`,
    };
  }
  if (top.probability >= SUSPECT_PROBABILITY_THRESHOLD) {
    return {
      verdict: 'suspected_downgrade',
      reason: `疑似降级：声明 ${claimedModel}，实际归因到 ${top.model}（P=${top.probability.toFixed(2)}）${lowConfidenceNote}`,
    };
  }
  return {
    verdict: 'inconclusive',
    reason: `top1 为 ${top.model} 但置信度不足（P=${top.probability.toFixed(2)}）${lowConfidenceNote}`,
  };
}
