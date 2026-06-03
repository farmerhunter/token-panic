import { describe, expect, it } from 'vitest';
import { toDashboardViewModel } from './dashboard-view-model';
import type { ProviderSummary } from '@shared/types';

const deepseekSummary: ProviderSummary = {
  provider_id: 'deepseek', display_name: 'DeepSeek', status: 'ok',
  quota_model: 'balance', source: 'official_api',
  primary_metric: '¥50.71 剩余', last_fetch: '2026-06-02T00:00:00.000Z',
};

const kimiSummary: ProviderSummary = {
  provider_id: 'kimi', display_name: 'Kimi', status: 'ok',
  quota_model: 'balance', source: 'official_api',
  primary_metric: '¥49.58 剩余', last_fetch: '2026-06-03T00:00:00.000Z',
};

const openaiSummary: ProviderSummary = {
  provider_id: 'openai_platform', display_name: 'OpenAI Platform', status: 'ok',
  quota_model: 'cost', source: 'official_api',
  primary_metric: '今日 $1.05', last_fetch: '2026-06-02T00:00:00.000Z',
};

const chatgptOk: ProviderSummary = {
  provider_id: 'chatgpt', display_name: 'ChatGPT', status: 'ok',
  quota_model: 'limit', source: 'manual', capture_method: 'safari_visible_tab',
  primary_metric: '5h 40% 剩余  week 86% 剩余', last_fetch: '2026-06-02T00:00:00.000Z',
};

const chatgptManualRequired: ProviderSummary = {
  ...chatgptOk, status: 'manual_required', primary_metric: '',
};

const defaultInput = {
  deepseekSummary, deepseekLoading: false,
  kimiSummary, kimiLoading: false,
  openaiSummary, openaiLoading: false,
  chatgptSummary: chatgptOk,
};

describe('toDashboardViewModel', () => {
  it('should keep global dashboard actions visible', () => {
    const vm = toDashboardViewModel(defaultInput);
    expect(vm.headerActions).toContain('refresh_deepseek');
    expect(vm.headerActions).toContain('open_settings');
  });

  it('should include both balance providers in balanceProviders array', () => {
    const vm = toDashboardViewModel(defaultInput);
    expect(vm.balanceProviders).toHaveLength(2);
    expect(vm.balanceProviders[0].provider_id).toBe('deepseek');
    expect(vm.balanceProviders[1].provider_id).toBe('kimi');
  });

  it('should have refresh actions for each balance provider', () => {
    const vm = toDashboardViewModel(defaultInput);
    expect(vm.balanceProviders[0].actions).toContain('refresh_deepseek');
    expect(vm.balanceProviders[1].actions).toContain('refresh_kimi');
  });

  it('should not crash with null Kimi summary', () => {
    const vm = toDashboardViewModel({
      ...defaultInput, kimiSummary: null, kimiLoading: true,
    });
    const kimi = vm.balanceProviders.find((p) => p.provider_id === 'kimi')!;
    expect(kimi.summary).toBeNull();
    expect(kimi.loading).toBe(true);
  });

  it('should keep ChatGPT actions intact when Kimi is added', () => {
    const vm = toDashboardViewModel(defaultInput);
    expect(vm.limitProvider.kind).toBe('summary');
    expect(vm.limitProvider.actions).toContain('quick_capture_chatgpt');
    expect(vm.limitProvider.actions).toContain('manual_input_chatgpt');
  });

  it('should keep ChatGPT actions for empty state', () => {
    const vm = toDashboardViewModel({ ...defaultInput, chatgptSummary: chatgptManualRequired });
    expect(vm.limitProvider.kind).toBe('empty');
    expect(vm.limitProvider.actions).toContain('quick_capture_chatgpt');
    expect(vm.limitProvider.actions).toContain('manual_input_chatgpt');
  });

  it('should keep OpenAI cost provider intact', () => {
    const vm = toDashboardViewModel(defaultInput);
    expect(vm.costProvider.provider_id).toBe('openai_platform');
    expect(vm.costProvider.actions).toContain('refresh_openai_platform');
  });

  it('should isolate all four providers', () => {
    const vm = toDashboardViewModel({
      ...defaultInput,
      kimiSummary: null, kimiLoading: false,
      openaiSummary: null, openaiLoading: true,
    });

    // DeepSeek must still work
    expect(vm.balanceProviders[0].summary?.primary_metric).toContain('¥');

    // Kimi must still be in the array even with null summary
    expect(vm.balanceProviders[1].summary).toBeNull();

    // OpenAI must still be present
    expect(vm.costProvider.loading).toBe(true);

    // ChatGPT must still work
    expect(vm.limitProvider.actions).toContain('quick_capture_chatgpt');
  });
});
