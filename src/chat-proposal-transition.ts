export type ProposalWithStatus = { id: string; status: string; [key: string]: unknown }

export function transitionProposalList<T extends ProposalWithStatus>(
  proposals: T[],
  proposalId: string,
  allowedStatuses: readonly string[] | null,
  patch: Partial<T>,
): { proposals: T[]; proposal: T; changed: boolean } {
  const index = proposals.findIndex((proposal) => proposal.id === proposalId)
  if (index < 0) throw new Error('That proposal is no longer available.')
  const current = proposals[index]
  if (allowedStatuses && !allowedStatuses.includes(current.status)) {
    return { proposals, proposal: current, changed: false }
  }
  const updated = { ...current, ...patch } as T
  const next = [...proposals]
  next[index] = updated
  return { proposals: next, proposal: updated, changed: true }
}
