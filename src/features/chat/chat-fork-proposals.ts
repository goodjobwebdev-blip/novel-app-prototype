export type ForkableProposal = { status: string; [key: string]: unknown }

export function snapshotProposalForFork<T extends ForkableProposal>(proposal: T): T {
  if (proposal.status === 'proposed' || proposal.status === 'applying') {
    return { ...proposal, status: 'stale' } as T
  }
  return { ...proposal }
}

export function snapshotProposalListForFork<T extends ForkableProposal>(proposals?: T[]): T[] | undefined {
  return proposals?.map(snapshotProposalForFork)
}
