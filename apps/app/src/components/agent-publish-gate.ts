// Publish takes only an assistant id -- it ships the PERSISTED draft. When the
// on-screen form is dirty, the config the admin is looking at and the config
// that would be published are different objects, and the post-publish refetch
// then resets the form and destroys the difference. Publishing is therefore
// only meaningful when the form is clean.

export interface PublishGateState {
  hasActiveAgent: boolean;
  isDraftDirty: boolean;
  isPublishing: boolean;
}

export function canPublishAgent(state: PublishGateState): boolean {
  return state.hasActiveAgent && !state.isDraftDirty && !state.isPublishing;
}

/** True when a server re-seed of the draft form would destroy unsaved edits. */
export function shouldResetDraftForm(input: {
  isDirty: boolean;
  agentChanged: boolean;
}): boolean {
  return input.agentChanged || !input.isDirty;
}
