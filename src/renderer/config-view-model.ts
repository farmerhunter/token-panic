import type { ProviderSource, QuotaModel } from '@shared/types';

export type ProviderConfigActionId =
  | 'edit_api_key'
  | 'manual_input'
  | 'quick_capture';

export type CredentialStatus = 'configured' | 'missing' | 'not_required';

export interface ProviderConfigVM {
  provider_id: string;
  display_name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  credential_status: CredentialStatus;
  hint: string;
  actions: ProviderConfigActionId[];
}

/**
 * Build the settings/config ViewModel for all known providers.
 * This is the config analog of toDashboardViewModel() —
 * action availability is a contract, not ad-hoc JSX branching.
 */
export function toConfigViewModel(inputs: {
  deepseekCredentialStatus: CredentialStatus;
  openaiCredentialStatus: CredentialStatus;
}): ProviderConfigVM[] {
  return [
    {
      provider_id: 'deepseek',
      display_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      credential_status: inputs.deepseekCredentialStatus,
      hint: '在 DeepSeek 平台「API Keys」页面创建。密钥保存在本地，不会上传。',
      actions: ['edit_api_key'],
    },
    {
      provider_id: 'openai_platform',
      display_name: 'OpenAI Platform',
      source: 'official_api',
      quota_model: 'cost',
      credential_status: inputs.openaiCredentialStatus,
      hint: '需要 organization admin API key（非普通 secret key）。在 platform.openai.com → Settings → Organization → API keys 创建。',
      actions: ['edit_api_key'],
    },
    {
      provider_id: 'chatgpt',
      display_name: 'ChatGPT / Codex',
      source: 'manual',
      quota_model: 'limit',
      credential_status: 'not_required',
      hint: '通过 Safari 自动读取或手动输入限额数据。不需要 API key。',
      actions: ['quick_capture', 'manual_input'],
    },
  ];
}
