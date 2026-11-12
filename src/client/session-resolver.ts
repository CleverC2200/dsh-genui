import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

interface SessionRetainSnapshot {
  retainedBy: { mainView?: number }
}

interface SessionRetainInfo {
  getSnapshot(): SessionRetainSnapshot
}

export function resolveViewedSessionId(
  list: Pick<SessionListState, 'ids'>,
  retainInfo: (sessionId: SessionId) => SessionRetainInfo,
): SessionId | undefined {
  return list.ids.find(sessionId => (retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0)
}
