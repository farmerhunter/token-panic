import { describe, expect, it } from 'vitest';
import { toConfigViewModel } from './config-view-model';

describe('toConfigViewModel', () => {
  const defaultInput = {
    deepseekCredentialStatus: 'configured' as const,
    openaiCredentialStatus: 'missing' as const,
    kimiCredentialStatus: 'missing' as const,
  };

  it('should include all four known providers', () => {
    const vms = toConfigViewModel(defaultInput);
    expect(vms).toHaveLength(4);
    expect(vms.map((v) => v.provider_id)).toEqual([
      'deepseek',
      'kimi',
      'openai_platform',
      'chatgpt',
    ]);
  });

  it('should expose edit_api_key for official_api providers', () => {
    const vms = toConfigViewModel(defaultInput);
    const ds = vms.find((v) => v.provider_id === 'deepseek')!;
    const oa = vms.find((v) => v.provider_id === 'openai_platform')!;
    expect(ds.actions).toContain('edit_api_key');
    expect(oa.actions).toContain('edit_api_key');
  });

  it('should expose quick_capture and manual_input for ChatGPT', () => {
    const vms = toConfigViewModel(defaultInput);
    const cg = vms.find((v) => v.provider_id === 'chatgpt')!;
    expect(cg.actions).toContain('quick_capture');
    expect(cg.actions).toContain('manual_input');
    expect(cg.credential_status).toBe('not_required');
  });

  it('should reflect credential status correctly', () => {
    const vms = toConfigViewModel({
      deepseekCredentialStatus: 'missing',
      openaiCredentialStatus: 'configured',
    });
    expect(vms.find((v) => v.provider_id === 'deepseek')!.credential_status).toBe('missing');
    expect(vms.find((v) => v.provider_id === 'openai_platform')!.credential_status).toBe('configured');
  });

  it('should not include disable/enable actions (deferred to later phase)', () => {
    const vms = toConfigViewModel(defaultInput);
    for (const vm of vms) {
      expect(vm.actions).not.toContain('disable_provider');
      expect(vm.actions).not.toContain('enable_provider');
    }
  });
});
