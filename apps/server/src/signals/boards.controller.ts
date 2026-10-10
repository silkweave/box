import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { deleteBoard, readBoardCandidates, readBoards, readBoardView, setBoardNodes, upsertBoard } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import type { PrincipalRequest } from '../auth/auth.decorators.js'

// Circuit boards - user-created canvases of nodes of any registered kind (signals; goals and
// initiatives through planning), which ones are on a board and where each sits. Edges are NOT here:
// they are derived from the objects (a signal's `depends_on`, a goal's signal, an initiative's goals)
// and draw when both ends are on the board. See core signals/board-kinds.ts.
//
// GUARD LEVEL: any authenticated internal user, deliberately NOT admin (bare AuthGuard, the
// planning-mutation precedent). The repo's admin line is "configuration wired to credentials or
// data ownership" - a board composes ALREADY-curated claims, and the dangerous mutation (creating
// or editing an edge) stays admin-gated on signal-upsert. Admin-gating board writes would also kill
// the primary interaction: a non-admin's drag could never persist, which is exactly the "positions
// are not saved" complaint this surface exists to close. Collaborators see none of it - a bare
// controller is internal-only.
//
// Concurrency is last-write-wins per board: `nodes` is written WHOLE, no version precondition, no
// 409. Two people dragging one board lose one arrangement, attributed by `updated_by` (the repo's
// standing posture, matching DocSave).

class BoardNodeDto {
  @ApiProperty({ description: "Node kind: 'signal', and with planning 'goal' or 'initiative'" }) kind!: string
  @ApiProperty({ description: 'The id of the object within its kind' }) ref!: string
  @ApiProperty({ description: 'Flow units, stored verbatim; snapping is the client\'s job' }) x!: number
  @ApiProperty() y!: number
}
class BoardDto {
  @ApiProperty() id!: string
  @ApiProperty() label!: string
  @ApiProperty() description!: string
  @ApiProperty({ type: [BoardNodeDto], description: 'Membership + positions; one entry per object' })
  nodes!: BoardNodeDto[]
  @ApiProperty() sort!: number
  @ApiProperty() created_at!: string
  @ApiProperty() updated_at!: string
  @ApiProperty({ required: false, nullable: true }) created_by!: string | null
  @ApiProperty({ required: false, nullable: true }) updated_by!: string | null
}
class BoardsDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [BoardDto] }) boards!: BoardDto[]
}

class BoardIdDto {
  @ApiProperty({ description: 'Board id' }) @IsString() id!: string
}
class BoardViewDto {
  @ApiProperty({ type: BoardDto }) board!: BoardDto
  @ApiProperty({ description: 'Installed node kinds: {kind, label, layer}' }) kinds!: unknown
  @ApiProperty({
    description:
      'Placements resolved: {kind, ref, key, x, y, card, neighbors}. card is {title, subtitle, value, unit, badge, progress, sparkline, footer, href, details} or null when missing; neighbors are the keys (kind:ref) of every linked object, on the board or not',
  })
  nodes!: unknown
  @ApiProperty({ description: 'Edges with both ends on the board: {id, source, target} as node keys; source moves target' })
  edges!: unknown
  @ApiProperty({ description: 'Placements that resolve to nothing: {kind, ref, reason}' }) missing!: unknown
  @ApiProperty({ type: [String], description: 'Change-feed scopes that can alter this view' }) watch!: string[]
}
class BoardCandidatesDto {
  @ApiProperty({ description: 'Per kind: {kind, label, candidates: [{ref, title, group}]}' }) kinds!: unknown
}

class UpsertBoardDto {
  @ApiProperty({ description: 'Slug id (lowercase a-z 0-9 dashes)' }) @IsString() id!: string
  @ApiProperty({ required: false, description: 'Human name, e.g. "Outreach funnel"' })
  @IsOptional() @IsString() label?: string
  @ApiProperty({ required: false, description: "What this board is for ('' clears it)" })
  @IsOptional() @IsString() description?: string
  @ApiProperty({ required: false, description: 'Sidebar ordering' }) @IsOptional() @IsInt() sort?: number
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class DeleteBoardDto {
  @ApiProperty({ description: 'Board id to delete (there is no undo - the arrangement is gone)' })
  @IsString() id!: string
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

// The @Mcp() scalar-inputs constraint again: `nodes` travels as a JSON array STRING, the
// signal-points-set precedent.
class SetBoardNodesDto {
  @ApiProperty({ description: 'Board id' }) @IsString() id!: string
  @ApiProperty({
    description:
      'JSON array string of {kind, ref, x, y}, e.g. [{"kind":"signal","ref":"mrr","x":0,"y":96},{"kind":"goal","ref":"mrr-12k","x":0,"y":288}]. Replaces the WHOLE list',
  })
  @IsString() nodes!: string
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class BoardDeleteReportDto {
  @ApiProperty() id!: string
  @ApiProperty({ description: 'How many placements the deleted board held (the objects themselves are untouched)' })
  nodes!: number
}

@Controller('boards')
@UseGuards(AuthGuard)
export class BoardsController {
  /**
   * tRPC query `boardsList` / MCP `boards-list` - every board with its full node list. Boards are
   * few and small, so there is no per-board read: the SPA caches this in its own store (separate
   * from the heavy `signalsData` payload) and a drag-save echo costs a few hundred bytes.
   */
  @Get()
  @ApiOkResponse({ type: BoardsDto })
  @Trpc()
  @Mcp({ name: 'boards-list' })
  async list(): Promise<BoardsDto> {
    const boards = (await readBoards()) as BoardDto[]
    return { generatedAt: new Date().toISOString(), boards }
  }

  /**
   * tRPC mutation `boardsView` (a read with input, the goals-get precedent) / MCP `board-get` - one board with every node resolved into a card
   * (value, health, progress), the edges between its nodes, each node's linked objects on or off
   * the board, and the placements that no longer resolve.
   */
  @Post('view')
  @ApiOkResponse({ type: BoardViewDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'board-get' })
  async view(@Body() body: BoardIdDto): Promise<BoardViewDto> {
    const view = await readBoardView(body.id)
    if (!view) throw new BadRequestException(`board ${body.id} not found`)
    return view as unknown as BoardViewDto
  }

  /** tRPC query `boardsCandidates` / MCP `board-candidates` - everything a board could place, per kind. */
  @Get('candidates')
  @ApiOkResponse({ type: BoardCandidatesDto })
  @Trpc()
  @Mcp({ name: 'board-candidates' })
  async candidates(): Promise<BoardCandidatesDto> {
    return { kinds: await readBoardCandidates() }
  }

  /**
   * tRPC mutation `boardsUpsert` / MCP `board-upsert` - create or partially update a board's
   * METADATA. It deliberately does not accept `nodes`: a label edit can then never race the
   * position autosave onto the same column.
   */
  @Post()
  @ApiOkResponse({ type: BoardsDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'board-upsert' })
  async upsert(@Body() body: UpsertBoardDto, @Req() req: PrincipalRequest): Promise<BoardsDto> {
    try {
      await upsertBoard({ ...body, actor: body.actor ?? req.principal?.id })
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return this.list()
  }

  /**
   * tRPC mutation `boardsDelete` / MCP `board-delete` - remove a board. Nothing cascades: a board
   * owns placements, never signals, edges or points. There is no soft delete and no undo.
   */
  @Post('delete')
  @ApiOkResponse({ type: BoardDeleteReportDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'board-delete' })
  async delete(@Body() body: DeleteBoardDto): Promise<BoardDeleteReportDto> {
    try {
      return await deleteBoard(body.id)
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * tRPC mutation `boardsNodesSet` / MCP `board-nodes-set` - replace a board's whole membership +
   * position list. The SPA's ~2s debounced autosave calls this; it is idempotent, and the domain
   * refuses a bad shape, a non-finite coordinate, an unknown kind or ref, or a duplicated node with
   * the reason.
   */
  @Post('nodes')
  @ApiOkResponse({ type: BoardsDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'board-nodes-set' })
  async nodesSet(@Body() body: SetBoardNodesDto, @Req() req: PrincipalRequest): Promise<BoardsDto> {
    let parsed: unknown
    try {
      parsed = JSON.parse(body.nodes)
    } catch {
      throw new BadRequestException(`nodes must be a JSON array string, e.g. [{"kind":"signal","ref":"mrr","x":0,"y":96}]`)
    }
    try {
      await setBoardNodes(body.id, parsed, body.actor ?? req.principal?.id)
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return this.list()
  }
}
