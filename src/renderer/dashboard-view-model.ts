import type { ProviderSummary } from '@shared/types';

export type DashboardActionId =
  | 'refresh_deepseek'
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

export interface DashboardViewModel {
  headerActions: DashboardActionId[];
  balanceProvider: {
    provider_id: 'deepseek';
    summary: ProviderSummary | null;
    loading: boolean;
  };
  limitProvider: LimitProviderCardVM;
}

const CHATGPT_ACTIONS: DashboardActionId[] = [
  'quick_capture_chatgpt',
  'manual_input_chatgpt',
];

export function toDashboardViewModel(input: {
  deepseekSummary: ProviderSummary | null;
  deepseekLoading: boolean;
  chatgptSummary: ProviderSummary | null;
}): DashboardViewModel {
  return {
    headerActions: ['refresh_deepseek', 'open_settings'],
    balanceProvider: {
      provider_id: 'deepseek',
      summary: input.deepseekSummary,
      loading: input.deepseekLoading,
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
