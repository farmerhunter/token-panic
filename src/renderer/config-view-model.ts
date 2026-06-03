import type { ProviderSource, QuotaModel } from '@shared/types';
import { ALL_PROVIDER_METAS } from '@shared/provider-metadata';

export type ProviderConfigActionId =
  | 'edit_api_key'
  | 'quick_capture_chatgpt'
  | 'manual_input_chatgpt';

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
  kimiCredentialStatus: CredentialStatus;
}): ProviderConfigVM[] {
  const statusMap: Record<string, CredentialStatus> = {
    deepseek: inputs.deepseekCredentialStatus,
    kimi: inputs.kimiCredentialStatus,
    openai_platform: inputs.openaiCredentialStatus,
    chatgpt: 'not_required',
  };

  return ALL_PROVIDER_METAS.map((meta) => ({
    provider_id: meta.provider_id,
    display_name: meta.display_name,
    source: meta.source,
    quota_model: meta.quota_model,
    credential_status: statusMap[meta.provider_id] || 'not_required',
    hint: meta.credential_hint || '',
    actions: meta.configurable
      ? ['edit_api_key' as const]
      : (meta.manual_action_ids as ProviderConfigActionId[]) || [],
  }));
}
