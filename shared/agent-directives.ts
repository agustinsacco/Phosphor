/** Shared by the session prompt and Settings preview: one tool-scoped policy. */
export function subagentPolicyBlock(): string {
  return [
    '<phosphor_subagents>',
    'When sub-agent tools are available, use them only for genuinely broad, independent work.',
    '- Native Claude Code Agent/Task: prefer run_in_background: false when its schema supports it; wait for the findings.',
    '- pi subagent: follow its advertised schema. Do not add run_in_background; that parameter belongs to Agent.',
    '- Answer directly when you can. Reading a handful of files is not a fan-out.',
    // pi-subagents wakes the parent only for events from LIVE runs. Once the
    // last run settles, nothing re-prompts it: a parent that ended its turn on
    // "X is next" sat idle 8h overnight (session 01a10e05). Goal-mission
    // notices are deliberately triggerTurn:false, so they do not cover this.
    '- A workflow that stops at a gate or finishes a stage does not resume itself, and nothing wakes you once no run is live. When the user asked you to keep going, never end a turn with the next step named and nothing running: launch it, or say what blocks it and what you need.',
    '- Read the subagent guide once per session for the topic you need, not before every launch.',
    '- Have a child check in only for a decision that is genuinely yours, and answer a pending question before other work.',
    '</phosphor_subagents>',
  ].join('\n')
}
