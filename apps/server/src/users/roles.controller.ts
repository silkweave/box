import { BadRequestException, Body, Controller, ForbiddenException, HttpException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { ACCESS_LEVELS, ROLE_ID, accessOf, applyPolicyChange, previewPolicyChange, roleExists, type PolicyPreview, deleteRole, describeAccess, knownAreas, listRoles, resolvePrincipalById, roleReferences, upsertRole, type AccessLevel, type Principal, type RoleDefinition } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin, Authenticated, Read } from '../auth/auth.decorators.js'
import { inputError } from '../auth/input-error.js'

const level = z.enum(['none', 'read', 'write'])
const roleOutput = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  default: level,
  areas: z.record(z.string(), level),
  builtin: z.boolean(),
  users: z.array(z.string()),
  agents: z.array(z.string()),
})
const rolesOutput = z.object({ areas: z.array(z.string()), roles: z.array(roleOutput) })
const explainOutput = z.object({ id: z.string(), role: z.string(), label: z.string(), admin: z.boolean(), revision: z.number(), areas: z.record(z.string(), level) })

class RoleDto {
  @ApiProperty() id!: string
  @ApiProperty() label!: string
  @ApiProperty() description!: string
  @ApiProperty({ enum: ACCESS_LEVELS }) default!: AccessLevel
  @ApiProperty({ type: Object, description: 'Level per named area' }) areas!: Record<string, AccessLevel>
  @ApiProperty() builtin!: boolean
  @ApiProperty({ type: [String], description: 'People on this role' }) users!: string[]
  @ApiProperty({ type: [String], description: 'Agents whose config names this role' }) agents!: string[]
}
class RolesDto {
  @ApiProperty({ type: [String], description: 'Every area of this Box: each installed feature, plus signals and ops' }) areas!: string[]
  @ApiProperty({ type: [RoleDto] }) roles!: RoleDto[]
}
class RoleUpsertDto {
  @ApiProperty({ description: 'A lowercase slug; admin and member are built in and cannot be changed' }) @IsString() @Matches(ROLE_ID) id!: string
  @ApiProperty() @IsString() @MaxLength(80) label!: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) description?: string
  @ApiProperty({ enum: ACCESS_LEVELS, description: 'The level of every area the role does not name, including areas installed later' })
  @IsIn(ACCESS_LEVELS) default!: AccessLevel
  @ApiProperty({ description: 'JSON object of area to level, e.g. {"crm":"write","planning":"read"} (areas: roles-list)' })
  @IsString() @MaxLength(8_000) areas!: string
  @ApiProperty({ required: false, description: 'The revision of the coverage preview being confirmed (required with confirm)' }) @IsOptional() @IsInt() revision?: number
  @ApiProperty({ required: false, enum: ['remove-members'], description: 'Also remove the room members the coverage preview listed' }) @IsOptional() @IsIn(['remove-members']) confirm?: 'remove-members'
}
class AgentRoleDto {
  @ApiProperty({ description: 'The agent id (data/config/agents/<id>.md; the system principal\'s role is box.json\'s)' }) @IsString() id!: string
  @ApiProperty({ description: 'admin, member or a custom role id' }) @IsString() @Matches(ROLE_ID) role!: string
  @ApiProperty({ required: false }) @IsOptional() @IsInt() revision?: number
  @ApiProperty({ required: false, enum: ['remove-members'] }) @IsOptional() @IsIn(['remove-members']) confirm?: 'remove-members'
}
class PolicyPreviewDto {
  @ApiProperty({ required: false, enum: ['role', 'user-role', 'agent-role'], description: 'What the change is' }) @IsIn(['role', 'user-role', 'agent-role']) kind!: 'role' | 'user-role' | 'agent-role'
  @ApiProperty({ description: 'The role id (kind role) or the user or agent id' }) @IsString() id!: string
  @ApiProperty({ required: false, description: 'user-role, agent-role: the new role id' }) @IsOptional() @IsString() role?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) label?: string
  @ApiProperty({ required: false, enum: ACCESS_LEVELS }) @IsOptional() @IsIn(ACCESS_LEVELS) default?: AccessLevel
  @ApiProperty({ required: false, description: 'kind role: JSON object of area to level' }) @IsOptional() @IsString() @MaxLength(8_000) areas?: string
}
class RoleIdDto {
  @ApiProperty() @IsString() id!: string
}
class ExplainDto {
  @ApiProperty({ required: false, description: 'The user or agent id; omit for yourself. Explaining someone else is admin-only.' })
  @IsOptional() @IsString() id?: string
}
class ExplainResultDto {
  @ApiProperty() id!: string
  @ApiProperty() role!: string
  @ApiProperty() label!: string
  @ApiProperty() admin!: boolean
  @ApiProperty() revision!: number
  @ApiProperty({ type: Object }) areas!: Record<string, AccessLevel>
}

interface PrincipalRequest {
  principal?: Principal | null
}

function parseAreas(raw: string): Record<string, AccessLevel> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BadRequestException('areas must be a JSON object of area to level')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BadRequestException('areas must be a JSON object of area to level')
  return parsed as Record<string, AccessLevel>
}

const badRequest = (e: unknown): never => {
  if (e instanceof HttpException) throw e
  throw inputError(e)
}

/**
 * Roles (docs/AUTH.md "Roles and areas"): `admin` and `member` are built in; custom roles grant a
 * level per area. Reading the roles is anyone's (the user directory shows role labels); changing
 * them, and explaining someone else's access, is admin.
 */
@Controller('roles')
@UseGuards(AuthGuard)
export class RolesController {
  /** tRPC query `rolesList` / MCP `roles-list` - every role with who holds it, and every area. */
  @Post('list')
  @ApiOkResponse({ type: RolesDto })
  @Trpc({ kind: 'query', output: rolesOutput })
  @Mcp({ name: 'roles-list' })
  @Authenticated()
  @Read()
  async list(): Promise<RolesDto> {
    const roles = await listRoles()
    return {
      areas: knownAreas(),
      roles: await Promise.all(roles.map(async (role: RoleDefinition) => ({ ...role, ...(await roleReferences(role.id)) }))),
    }
  }

  /** tRPC mutation `rolesUpsert` / MCP `role-upsert` - create or replace a custom role. */
  @Post('upsert')
  @ApiOkResponse({ type: RoleDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: roleOutput })
  @Mcp({ name: 'role-upsert' })
  async upsert(@Body() body: RoleUpsertDto, @Req() req: PrincipalRequest): Promise<RoleDto> {
    try {
      const role = await upsertRole({ id: body.id, label: body.label, description: body.description, default: body.default, areas: parseAreas(body.areas) }, req.principal?.id, { revision: body.revision, confirm: body.confirm })
      return { ...role, ...(await roleReferences(role.id)) }
    } catch (e) {
      return badRequest(e)
    }
  }

  /**
   * tRPC mutation `rolesPreview` / MCP `policy-preview` - the coverage violations a role edit, a
   * user's role change or an agent's role change would cause (PERMISSIONS 7.2), at the current
   * policy revision. Changes nothing; the save repeats `revision` with `confirm` to remove members.
   */
  @Post('preview')
  @Admin()
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'policy-preview' })
  @Read()
  async preview(@Body() body: PolicyPreviewDto, @Req() req: PrincipalRequest): Promise<PolicyPreview> {
    try {
      const actor = req.principal?.id
      if (body.kind === 'role') {
        return await previewPolicyChange({ reason: `preview role ${body.id}`, actor, roles: { upsert: [{ id: body.id, label: body.label ?? body.id, default: body.default ?? 'none', areas: parseAreas(body.areas ?? '{}') }] } })
      }
      if (!body.role) throw new Error('role is required')
      if (body.kind === 'user-role') return await previewPolicyChange({ reason: `preview role of ${body.id}`, actor, users: { [body.id]: body.role } })
      return await previewPolicyChange({ reason: `preview role of agent ${body.id}`, actor, agents: { [body.id]: body.role } })
    } catch (e) {
      return badRequest(e)
    }
  }

  /**
   * tRPC mutation `rolesAgentSet` / MCP `agent-set-role` - change an agent's role: rewrites its
   * config file through the policy journal after the coverage preview (refused with the list, or
   * confirmed with `confirm: 'remove-members'` and the preview's revision).
   */
  @Post('agent-set-role')
  @Admin()
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'agent-set-role' })
  async agentSetRole(@Body() body: AgentRoleDto, @Req() req: PrincipalRequest): Promise<{ ok: boolean; revision: number; removed: string[] }> {
    try {
      if (!(await roleExists(body.role))) throw new Error(`no role "${body.role}"`)
      const result = await applyPolicyChange({ reason: `agent role ${body.id}`, actor: req.principal?.id, agents: { [body.id]: body.role } }, { revision: body.revision, confirm: body.confirm })
      return { ok: true, revision: result.revision, removed: result.messages }
    } catch (e) {
      return badRequest(e)
    }
  }

  /** tRPC mutation `rolesDelete` / MCP `role-delete` - delete a custom role nobody holds. */
  @Post('delete')
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  @Admin()
  @Trpc({ kind: 'mutation', output: z.object({ ok: z.boolean() }) })
  @Mcp({ name: 'role-delete' })
  async remove(@Body() body: RoleIdDto): Promise<{ ok: boolean }> {
    try {
      await deleteRole(body.id)
      return { ok: true }
    } catch (e) {
      return badRequest(e)
    }
  }

  /** tRPC query `rolesExplain` / MCP `access-explain` - the level per area someone holds, and admin authority. */
  @Post('explain')
  @ApiOkResponse({ type: ExplainResultDto })
  @Trpc({ kind: 'query', output: explainOutput })
  @Mcp({ name: 'access-explain' })
  @Authenticated()
  @Read()
  async explain(@Body() body: ExplainDto, @Req() req: PrincipalRequest): Promise<ExplainResultDto> {
    const self = req.principal
    if (!self) throw new ForbiddenException('sign in required')
    const id = body.id ?? self.id
    if (id !== self.id && !(await accessOf(self)).admin) throw new ForbiddenException('explaining someone else\'s access is admin-only')
    const target = id === self.id ? self : await resolvePrincipalById(id)
    if (!target) throw new BadRequestException(`no active user or agent "${id}"`)
    return { id: target.id, ...(await describeAccess(await accessOf(target))) }
  }
}
