import type { Agent, Chat, Workspace } from '../api/types'

export function StatusPanel({
  activeAgent,
  activeChatId,
  activeAgentId,
  agents,
  chats,
  isCloning,
  onCloneAgent,
  onSelectAgent,
  onSelectChat,
  workspace
}: {
  activeAgent: Agent | undefined
  activeChatId: string | undefined
  activeAgentId: string | undefined
  agents: Agent[]
  chats: Chat[]
  isCloning: boolean
  onCloneAgent: () => void
  onSelectAgent: (agentId: string) => void
  onSelectChat: (chatId: string) => void
  workspace: Workspace | undefined
}) {
  return (
    <aside className="rm-panel p-4">
      <div className="rm-card-title">Milestone 1</div>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-muted">Workspace</dt>
          <dd>{workspace?.name ?? 'Loading'}</dd>
        </div>
        <div>
          <dt className="text-muted">Agent</dt>
          <dd>{activeAgent?.name ?? 'Loading'}</dd>
        </div>
        <div>
          <dt className="text-muted">Agents</dt>
          <dd>{agents.length}</dd>
        </div>
        <div>
          <dt className="text-muted">Chats</dt>
          <dd>{chats.length}</dd>
        </div>
      </dl>
      <div className="mt-5">
        <div className="mb-2 text-sm text-muted">Agents</div>
        <div className="grid gap-2">
          {agents.map((agent) => (
            <button
              className={`rm-button min-w-0 text-left ${agent.id === activeAgentId ? 'selected' : ''}`}
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              type="button"
            >
              <span className="block truncate">{agent.name}</span>
            </button>
          ))}
        </div>
        <button className="rm-button mt-2 w-full" disabled={activeAgent === undefined || isCloning} onClick={onCloneAgent} type="button">
          {isCloning ? 'Cloning' : 'Clone agent'}
        </button>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm text-muted">Recent chats</div>
        <div className="grid gap-2">
          {chats.length === 0 ? (
            <div className="text-sm text-muted">No chats yet.</div>
          ) : (
            chats.map((chat) => (
              <button
                className={`rm-button min-w-0 text-left ${chat.id === activeChatId ? 'selected' : ''}`}
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                type="button"
              >
                <span className="block truncate">{chat.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}
