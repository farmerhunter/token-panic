import type { ProviderSummary } from '@shared/types';
import { DEEPSEEK_META, KIMI_META, OPENAI_PLATFORM_META } from '@shared/provider-metadata';

export type DashboardActionId =
  | 'refresh_deepseek'
  | 'refresh_kimi'
  | 'refresh_openai_platform'
  | 'open_settings'
  | 'quick_capture_chatgpt'
  | 'manual_input_chatgpt';

export type LimitProviderCardVM =
  | {
      kind: 'empty';
      provider_id: 'chatgpt';
      title: string;
      actions: DashboardActionId[];
    }
  | {
      kind: 'summary';
      provider_id: 'chatgpt';
      summary: ProviderSummary;
      actions: DashboardActionId[];
    };

export interface ProviderCardVM {
  provider_id: string;
  summary: ProviderSummary | null;
  loading: boolean;
  actions: DashboardActionId[];
}

export interface DashboardViewModel {
  headerActions: DashboardActionId[];
  balanceProviders: ProviderCardVM[]; // DD-027: array for multiple balance providers
  costProvider: ProviderCardVM;
  limitProvider: LimitProviderCardVM;
}

const CHATGPT_ACTIONS: DashboardActionId[] = [
  'quick_capture_chatgpt',
  'manual_input_chatgpt',
];

export function toDashboardViewModel(input: {
  deepseekSummary: ProviderSummary | null;
  deepseekLoading: boolean;
  kimiSummary: ProviderSummary | null;
  kimiLoading: boolean;
  openaiSummary: ProviderSummary | null;
  openaiLoading: boolean;
  chatgptSummary: ProviderSummary | null;
}): DashboardViewModel {
  return {
    headerActions: ['refresh_deepseek', 'open_settings'],
    // refresh_action_id is always set for official_api providers (see provider-metadata)
    balanceProviders: [
      {
        provider_id: DEEPSEEK_META.provider_id,
        summary: input.deepseekSummary,
        loading: input.deepseekLoading,
        actions: [DEEPSEEK_META.refresh_action_id!],
      },
      {
        provider_id: KIMI_META.provider_id,
        summary: input.kimiSummary,
        loading: input.kimiLoading,
        actions: [KIMI_META.refresh_action_id!],
      },
    ],
    costProvider: {
      provider_id: OPENAI_PLATFORM_META.provider_id,
      summary: input.openaiSummary,
      loading: input.openaiLoading,
      actions: [OPENAI_PLATFORM_META.refresh_action_id!],
    },
    limitProvider: toChatGptLimitCard(input.chatgptSummary),
  };
}

function toChatGptLimitCard(summary: ProviderSummary | null): LimitProviderCardVM {
  if (!summary || summary.status === 'manual_required') {
    return {
      kind: 'empty',
      provider_id: 'chatgpt',
      title: 'ChatGPT / Codex',
      actions: CHATGPT_ACTIONS,
    };
  }

  return {
    kind: 'summary',
    provider_id: 'chatgpt',
    summary,
    actions: CHATGPT_ACTIONS,
  };
}
