import { describe, expect, it } from 'vitest';
import { toDashboardViewModel } from './dashboard-view-model';
import type { ProviderSummary } from '@shared/types';

const deepseekSummary: ProviderSummary = {
  provider_id: 'deepseek',
  display_name: 'DeepSeek',
  status: 'ok',
  quota_model: 'balance',
  source: 'official_api',
  primary_metric: '¥50.71 剩余',
  last_fetch: '2026-06-02T00:00:00.000Z',
};

const chatgptManualRequired: ProviderSummary = {
  provider_id: 'chatgpt',
  display_name: 'ChatGPT',
  status: 'manual_required',
  quota_model: 'limit',
  source: 'manual',
  primary_metric: '',
  last_fetch: '2026-06-02T00:00:00.000Z',
};

const chatgptOk: ProviderSummary = {
  provider_id: 'chatgpt',
  display_name: 'ChatGPT',
  status: 'ok',
  quota_model: 'limit',
  source: 'manual',
  capture_method: 'safari_visible_tab',
  primary_metric: '5h 40% 剩余  week 86% 剩余',
  last_fetch: '2026-06-02T00:00:00.000Z',
};

describe('toDashboardViewModel', () => {
  it('should keep global dashboard actions visible', () => {
    const vm = toDashboardViewModel({
      deepseekSummary,
      deepseekLoading: false,
      chatgptSummary: chatgptManualRequired,
    });

    expect(vm.headerActions).toContain('refresh_deepseek');
    expect(vm.headerActions).toContain('open_settings');
  });

  it('should expose both ChatGPT capture and manual input actions before data exists', () => {
    const vm = toDashboardViewModel({
      deepseekSummary,
      deepseekLoading: false,
      chatgptSummary: chatgptManualRequired,
    });

    expect(vm.limitProvider.kind).toBe('empty');
    expect(vm.limitProvider.actions).toContain('quick_capture_chatgpt');
    expect(vm.limitProvider.actions).toContain('manual_input_chatgpt');
  });

  it('should preserve both ChatGPT actions after Safari data is saved', () => {
    const vm = toDashboardViewModel({
      deepseekSummary,
      deepseekLoading: false,
      chatgptSummary: chatgptOk,
    });

    expect(vm.limitProvider.kind).toBe('summary');
    expect(vm.limitProvider.actions).toContain('quick_capture_chatgpt');
    expect(vm.limitProvider.actions).toContain('manual_input_chatgpt');
    if (vm.limitProvider.kind === 'summary') {
      expect(vm.limitProvider.summary.primary_metric).toContain('40%');
    }
  });

  it('should keep DeepSeek and ChatGPT state separate in the dashboard model', () => {
    const vm = toDashboardViewModel({
      deepseekSummary,
      deepseekLoading: false,
      chatgptSummary: chatgptOk,
    });

    expect(vm.balanceProvider.provider_id).toBe('deepseek');
    expect(vm.balanceProvider.summary?.primary_metric).toContain('¥');
    expect(vm.limitProvider.provider_id).toBe('chatgpt');
  });
});
