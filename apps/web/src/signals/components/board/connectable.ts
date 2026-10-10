import type { BoardNodeAttachment, BoardViewNode } from '../../lib/useBoardsData.ts'

// Which of a node's links the canvas still has to offer. Kept out of CircuitBoardFlow so the board
// view can use it without pulling the lazily loaded graph library into its own chunk.

/** A card's attachments that are not placed as nodes of their own (a placed initiative is drawn
 *  once, as its node, never twice). */
export function visibleAttachments(node: BoardViewNode, onBoard: Set<string>): BoardNodeAttachment[] {
  return (node.card?.attachments ?? []).filter((a) => !onBoard.has(a.key))
}

/** What "Add connected" would place: linked objects not on the board and not already drawn as
 *  attachments on this card. */
export function connectable(node: BoardViewNode, onBoard: Set<string>): string[] {
  const attached = new Set((node.card?.attachments ?? []).map((a) => a.key))
  return node.neighbors.filter((k) => !onBoard.has(k) && !attached.has(k))
}
