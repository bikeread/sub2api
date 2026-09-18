import { describe, expect, it } from 'vitest';
import { getModelCatalog, reasoningLabel, resolveSelection } from './options';

const catalog = getModelCatalog({
  upstream_model_metadata: {
    models: {
      'gpt-5.5': { supported_reasoning_levels: ['low', 'high'] },
      'custom-model': { reasoning: false },
      'gpt-6-astra': { supported_reasoning_levels: ['medium', 'xhigh'] },
    },
  },
});

describe('model and reasoning dropdowns', () => {
  it('uses the account catalog and only supported reasoning levels', () => {
    expect(catalog.source).toBe('account');
    expect(catalog.models).toEqual([
      { id: 'gpt-5.5', reasoningEfforts: ['low', 'high'] },
      { id: 'custom-model', reasoningEfforts: [] },
      { id: 'gpt-6-astra', reasoningEfforts: ['medium', 'xhigh'] },
    ]);
  });
  it('does not invent models or effort levels when sync data is missing', () => {
    expect(getModelCatalog()).toEqual({ source: 'missing', models: [] });
    expect(
      getModelCatalog({
        upstream_model_metadata: { models: { 'gpt-6-astra': {} } },
      }).models,
    ).toEqual([{ id: 'gpt-6-astra', reasoningEfforts: [] }]);
    expect(
      resolveSelection(getModelCatalog(), 'fingerprint', '', 'high'),
    ).toMatchObject({ models: [], resolvedModel: '', efforts: [], effort: '' });
  });
  it('keeps every advertised effort including ultra, with no fixed-list filtering', () => {
    const models = getModelCatalog({
      upstream_model_metadata: {
        models: {
          'gpt-6-astra': {
            supported_reasoning_levels: [
              'low',
              'ultra',
              'future-effort',
              'ultra',
              '',
            ],
          },
        },
      },
    }).models;
    expect(models[0].reasoningEfforts).toEqual([
      'low',
      'ultra',
      'future-effort',
    ]);
  });
  it('does not borrow the supported levels of a different model', () => {
    const synced = getModelCatalog({
      upstream_model_metadata: {
        models: {
          'gpt-6-astra': {
            supported_reasoning_levels: [
              'low',
              'medium',
              'high',
              'xhigh',
              'max',
              'ultra',
            ],
          },
          'gpt-5.5': {},
        },
      },
    });
    expect(
      resolveSelection(synced, 'prompt', 'gpt-6-astra', 'ultra').effort,
    ).toBe('ultra');
    expect(
      resolveSelection(synced, 'prompt', 'gpt-5.5', 'ultra'),
    ).toMatchObject({ efforts: [], effort: '' });
  });
  it('offers outside-bank models only for manual prompts and resolves automatic fingerprint models by priority', () => {
    expect(
      resolveSelection(catalog, 'prompt').models.map((m) => m.id),
    ).toContain('custom-model');
    const selection = resolveSelection(
      catalog,
      'fingerprint',
      'custom-model',
      'high',
    );
    expect(selection.model).toBe('');
    expect(selection.resolvedModel).toBe('gpt-6-astra');
    expect(selection.efforts).toEqual(['medium', 'xhigh']);
    expect(selection.effort).toBe('');
  });
  it('clears unsupported effort and removed models instead of submitting hidden values', () => {
    expect(
      resolveSelection(catalog, 'prompt', 'custom-model', 'high').effort,
    ).toBe('');
    expect(
      resolveSelection(catalog, 'prompt', 'removed-model', 'high'),
    ).toMatchObject({ model: '', resolvedModel: '', effort: '', efforts: [] });
    expect(resolveSelection(catalog, 'prompt', 'gpt-5.5', 'high').effort).toBe(
      'high',
    );
  });
});

it('renders newly advertised levels as plain labels', () => {
  expect(reasoningLabel('ultra')).toBe('极限 · ultra');
  expect(reasoningLabel('future-effort')).toBe('future-effort');
  expect(reasoningLabel('constructor')).toBe('constructor');
});
