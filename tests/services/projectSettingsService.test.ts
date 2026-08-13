import { describe, expect, it } from 'vitest';
import {
  getAssistantTextModelCandidates,
  normalizeProjectSettings,
} from '../../src/services/projectSettingsService';

describe('assistant text model candidates', () => {
  it('prefers the project text default and keeps the application model as fallback', () => {
    expect(getAssistantTextModelCandidates({
      defaultModels: { text: 'general/project-model' },
    }, 'general/application-model')).toEqual([
      'general/project-model',
      'general/application-model',
    ]);
  });

  it('trims values, removes duplicates and supports projects without a default', () => {
    expect(getAssistantTextModelCandidates({
      defaultModels: { text: ' general/shared-model ' },
    }, 'general/shared-model')).toEqual(['general/shared-model']);
    expect(getAssistantTextModelCandidates(undefined, 'general/application-model'))
      .toEqual(['general/application-model']);
  });
});

describe('project visual model settings', () => {
  it('normalizes the vision model and only persists an enabled auto-routing flag', () => {
    expect(normalizeProjectSettings({
      visionModelId: ' general/vision-model ',
      modelAutoRouting: true,
    })).toMatchObject({
      visionModelId: 'general/vision-model',
      modelAutoRouting: true,
    });
    expect(normalizeProjectSettings({ visionModelId: ' ', modelAutoRouting: false }))
      .toEqual({});
  });
});
