interface AgentParameterControlsProps {
  disabled: boolean
  maxOutputTokens: string
  onMaxOutputTokensChange: (value: string) => void
  onTemperatureChange: (value: string) => void
  onTopPChange: (value: string) => void
  temperature: string
  topP: string
}

export function AgentParameterControls({
  disabled,
  maxOutputTokens,
  onMaxOutputTokensChange,
  onTemperatureChange,
  onTopPChange,
  temperature,
  topP
}: AgentParameterControlsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="grid gap-1 text-sm text-muted" htmlFor="agent-temperature">
        Temperature
        <input
          className="rm-input"
          disabled={disabled}
          id="agent-temperature"
          max="2"
          min="0"
          onChange={(event) => onTemperatureChange(event.currentTarget.value)}
          step="0.1"
          type="number"
          value={temperature}
        />
      </label>
      <label className="grid gap-1 text-sm text-muted" htmlFor="agent-top-p">
        Top P
        <input
          className="rm-input"
          disabled={disabled}
          id="agent-top-p"
          max="1"
          min="0"
          onChange={(event) => onTopPChange(event.currentTarget.value)}
          step="0.05"
          type="number"
          value={topP}
        />
      </label>
      <label className="grid gap-1 text-sm text-muted" htmlFor="agent-max-output-tokens">
        Max tokens
        <input
          className="rm-input"
          disabled={disabled}
          id="agent-max-output-tokens"
          min="1"
          onChange={(event) => onMaxOutputTokensChange(event.currentTarget.value)}
          step="1"
          type="number"
          value={maxOutputTokens}
        />
      </label>
    </div>
  )
}
