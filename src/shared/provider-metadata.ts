// ============================================================
// Provider static metadata — single source of truth for
// provider_id, display_name, quota_model, dashboard group,
// credential hints, and action IDs.
//
// Adapters, config ViewModel, and dashboard ViewModel should
// reference these constants instead of hardcoding strings.
// ============================================================

import type { ProviderSource, QuotaModel } from './types';

export type ProviderId = 'deepseek' | 'kimi' | 'openai_platform' | 'chatgpt';

export interface ProviderMeta {
  provider_id: ProviderId;
  display_name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  /** Dashboard section: 'balance' | 'cost' | 'limit' */
  dashboard_group: 'balance' | 'cost' | 'limit';
  configurable: boolean;
  credential_label?: string;
  credential_hint?: string;
  /** Required for official_api providers that support scheduler refresh */
  refresh_action_id?: string;
  manual_action_ids?: string[];
}

export const DEEPSEEK_META: ProviderMeta = {
  provider_id: 'deepseek',
  display_name: 'DeepSeek',
  source: 'official_api',
  quota_model: 'balance',
  dashboard_group: 'balance',
  configurable: true,
  credential_label: 'DeepSeek API Key',
  credential_hint: '在 DeepSeek 平台「API Keys」页面创建。密钥保存在本地，不会上传。',
  refresh_action_id: 'refresh_deepseek',
};

export const KIMI_META: ProviderMeta = {
  provider_id: 'kimi',
  display_name: 'Kimi',
  source: 'official_api',
  quota_model: 'balance',
  dashboard_group: 'balance',
  configurable: true,
  credential_label: 'Kimi (Moonshot) API Key',
  credential_hint: '在 platform.moonshot.cn 控制台创建 API key。使用中国区 API (api.moonshot.cn)。密钥保存在本地，不会上传。',
  refresh_action_id: 'refresh_kimi',
};

export const OPENAI_PLATFORM_META: ProviderMeta = {
  provider_id: 'openai_platform',
  display_name: 'OpenAI Platform',
  source: 'official_api',
  quota_model: 'cost',
  dashboard_group: 'cost',
  configurable: true,
  credential_label: 'OpenAI Platform API Key',
  credential_hint: '需要 organization admin API key（非普通 secret key，不是 ChatGPT 订阅）。在 platform.openai.com → Settings → Organization → API keys 创建。',
  refresh_action_id: 'refresh_openai_platform',
};

export const CHATGPT_META: ProviderMeta = {
  provider_id: 'chatgpt',
  display_name: 'ChatGPT / Codex',
  source: 'manual',
  quota_model: 'limit',
  dashboard_group: 'limit',
  configurable: false,
  credential_hint: '通过 Safari 自动读取或手动输入限额数据。不需要 API key。',
  manual_action_ids: ['quick_capture_chatgpt', 'manual_input_chatgpt'],
};

/** All known providers ordered for UI (config pages, dashboard sections) */
export const ALL_PROVIDER_METAS: ProviderMeta[] = [
  DEEPSEEK_META,
  KIMI_META,
  OPENAI_PLATFORM_META,
  CHATGPT_META,
];

/** API-key-configurable providers (for settings page) */
export const CONFIGURABLE_PROVIDER_METAS = ALL_PROVIDER_METAS.filter((m) => m.configurable);
