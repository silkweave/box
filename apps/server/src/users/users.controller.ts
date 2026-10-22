import { mkdirSync } from 'node:fs'
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { WORK_FS } from '../agent/work-session.js'
import { z } from 'zod/v4'
import { AgentFileError, createAgent, isConfiguredAgent, type PrincipalCredential, boxBrand, systemUserId, USER_ROLES, assertNotLastAdmin, deleteUser, parseSidebarLayout, readSidebarLayout, writeSidebarLayout, issuePrincipalToken, issueSigninLink, readUser, readUsers, normalizePhone, revealPrincipalToken, revokePrincipalToken, sameEmail, setPrincipalRole, upsertUser, type User, type UserRole, workFolderCreateProblem, workFolderProblem, workFolderSuggestions, type WorkAccess } from '@silkweave/box-core'
import { revokeAgentControl } from '../agent/agent-control.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin } from '../auth/auth.decorators.js'
import { appUrl, signinLinkUrl } from '../auth/app-url.js'

/** Whether a typed phone names the stored one (an invalid typed form never does). */
function samePhone(typed: string, stored: string | null): boolean {
  try {
    return normalizePhone(typed) === stored
  } catch {
    return false
  }
}

const userOutput = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  nickname: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  image: z.string().nullable(),
  color: z.string().nullable(),
  status: z.enum(['invited', 'active', 'revoked']),
  role: z.enum(['admin', 'member']),
  kind: z.enum(['human', 'agent']),
  tailscale_login: z.string().nullable(),
  channels: z.record(z.string(), z.string()),
  agent_profile: z.string().nullable(),
  has_token: z.boolean(),
  sort: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})
const usersOutput = z.object({ generatedAt: z.string(), users: z.array(userOutput) })
const inviteOutput = z.object({ token: z.string(), url: z.string(), message: z.string(), user: userOutput })
const linkOutput = z.object({ url: z.string(), expiresAt: z.string(), message: z.string(), user: userOutput })
const workFoldersOutput = z.object({ parent: z.string().nullable(), directories: z.array(z.string()), create: z.string().nullable() })
const workFolderOutput = z.object({ path: z.string() })
const sidebarOutput = z.object({ layout: z.object({ sections: z.array(z.string()), groups: z.array(z.string()), hidden: z.array(z.string()) }).nullable() })

// DTOs document the REST/Swagger surface and drive the generated tRPC input/output types, exactly
// like the sink/planning controllers. @Mcp() input fields are scalar-only so the cli proxy can build
// an option per field (no objects/nullable unions) - omit a field to leave it unchanged.
class UserDto {
  @ApiProperty() id!: string
  @ApiProperty() first_name!: string
  @ApiProperty() last_name!: string
  @ApiProperty() nickname!: string
  @ApiProperty({ required: false, nullable: true }) email!: string | null
  @ApiProperty({ required: false, nullable: true, description: 'Phone in E.164; how a messaging channel recognises this person as a team member' })
  phone!: string | null
  @ApiProperty({ required: false, nullable: true }) image!: string | null
  @ApiProperty({ required: false, nullable: true }) color!: string | null
  @ApiProperty({ description: 'Access lifecycle: active | invited | revoked' })
  status!: string
  @ApiProperty({ enum: USER_ROLES, description: 'Trust tier: admin | member (docs/core/AUTH.md § 3)' })
  role!: string
  @ApiProperty({ enum: ['human', 'agent'], description: 'human | agent: agents come from box.json agent and data/config/agents/<id>.md' })
  kind!: string
  @ApiProperty({ required: false, nullable: true, description: 'Tailscale login this user signs in as, when the Box runs behind tailscale serve' })
  tailscale_login!: string | null
  @ApiProperty({ type: Object, description: 'channel → handle map' })
  channels!: Record<string, string>
  @ApiProperty({ required: false, nullable: true, description: 'Default agent profile (`<person>:<engine>`); null = Claude first. The agent principal runs on it only' })
  agent_profile!: string | null
  @ApiProperty({ type: Object, description: 'Work capabilities: { enabled, data, sandbox, folders, folder_paths } (docs/AUTH.md § Work sessions). Admin-set; ignored for admins and agents' })
  work!: WorkAccess
  @ApiProperty({ description: 'Whether an access token has been issued (never the token itself)' })
  has_token!: boolean
  @ApiProperty() sort!: number
  @ApiProperty() created_at!: string
  @ApiProperty() updated_at!: string
}
class UsersDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [UserDto] }) users!: UserDto[]
}
class UpsertUserDto {
  @ApiProperty({ description: 'User slug (stable id, e.g. alice)' }) @IsString() id!: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() first_name?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() last_name?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() nickname?: string
  @ApiProperty({ required: false, description: 'Identity email ("" clears it). Admin-only to change; unique across users' })
  @IsOptional() @IsString() email?: string
  @ApiProperty({ required: false, description: 'Phone in international form ("" clears it). Admin-only to change; unique across users' })
  @IsOptional() @IsString() phone?: string
  @ApiProperty({ required: false, description: 'Avatar image URL or data: URI ("" clears it)' })
  @IsOptional() @IsString() image?: string
  @ApiProperty({ required: false, description: "Swatch name ('indigo', 'cyan', …; '' clears it)" })
  @IsOptional() @IsString() color?: string
  @ApiProperty({ required: false, description: 'JSON object of channel→handle - the source of truth for per-person presence' })
  @IsOptional() @IsString() channels?: string
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sort?: number
  @ApiProperty({ required: false, description: 'ADMIN-only: the tailscale login this user signs in as ("" clears it)' })
  @IsOptional() @IsString() tailscale_login?: string
  @ApiProperty({ required: false, description: 'Default agent profile, one of the user\'s agentProfiles ("" clears it)' })
  @IsOptional() @IsString() agent_profile?: string
  @ApiProperty({ required: false, description: 'ADMIN-only: JSON object of Work capabilities, merged over the stored value: { enabled?, data?, sandbox?, folders?, folder_paths? }' })
  @IsOptional() @IsString() work?: string
}
class SetRoleDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty({ enum: USER_ROLES, description: 'admin grants the credential and service surfaces; member is everything else' })
  @IsIn(USER_ROLES) role!: UserRole
}
class IdDto {
  @ApiProperty() @IsString() id!: string
}
class SidebarLayoutDto {
  @ApiProperty({ type: [String], description: 'Section headings, in the person\'s order' }) sections!: string[]
  @ApiProperty({ type: [String], description: 'Entry ids, in the person\'s order' }) groups!: string[]
  @ApiProperty({ type: [String], description: 'Entry ids the person hid' }) hidden!: string[]
}
class SidebarDto {
  @ApiProperty({ type: SidebarLayoutDto, nullable: true, description: 'The person\'s sidebar layout; null is the Box default' })
  layout!: SidebarLayoutDto | null
}
class SidebarSaveDto {
  @ApiProperty({ required: false, description: 'The layout as a JSON object string ({ sections, groups, hidden }); omit to restore the default' })
  @IsOptional() @IsString() @MaxLength(40_000) layout?: string
}
class WorkFolderQueryDto {
  @ApiProperty({ description: 'A partial absolute path on the Box host, as typed' }) @IsString() query!: string
}
class WorkFolderPathDto {
  @ApiProperty({ description: 'The absolute directory to create; its parent must exist' }) @IsString() path!: string
}
class WorkFoldersDto {
  @ApiProperty({ nullable: true, description: 'The directory whose children were listed' }) parent!: string | null
  @ApiProperty({ type: [String], description: 'Grantable directories completing the query' }) directories!: string[]
  @ApiProperty({ nullable: true, description: 'The query when it could be created as a Work folder' }) create!: string | null
}
class WorkFolderDto {
  @ApiProperty() path!: string
}
class LinkRequestDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty({ required: false, description: 'Minutes until the link expires (default 15, max 1440)' })
  @IsOptional()
  @IsInt()
  ttlMinutes?: number
}
class UserLinkDto {
  @ApiProperty({ description: 'The sign-in URL. Short-lived and single-use - safe to send.' }) url!: string
  @ApiProperty({ description: 'When it stops working (ISO-8601)' }) expiresAt!: string
  @ApiProperty({ description: 'Ready-to-send message containing the link' }) message!: string
  @ApiProperty({ type: UserDto }) user!: UserDto
}
class UserInviteDto {
  @ApiProperty({ description: 'Plaintext access token - handle like a password; "" when none is issued' })
  token!: string
  @ApiProperty({ description: 'The magic-link URL ("" when no token is issued)' }) url!: string
  @ApiProperty({ description: 'Ready-to-send invite message with the magic-link URL' }) message!: string
  @ApiProperty({ type: UserDto }) user!: UserDto
}

interface PrincipalRequest {
  principal?: { id: string; role?: string; kind?: string } | null
  credential?: PrincipalCredential
}

class AgentCreateDto {
  @ApiProperty({ description: 'The agent id: a lowercase slug (a-z, 0-9, -), new to this Box' }) @IsString() @MaxLength(63) id!: string
  @ApiProperty({ description: 'Display name' }) @IsString() @MaxLength(64) name!: string
  @ApiProperty({ enum: USER_ROLES, description: 'admin or member, as for a person' }) @IsIn(USER_ROLES) role!: UserRole
  @ApiProperty({ required: false, description: 'Instructions appended to the engine system prompt at each session start' })
  @IsOptional() @IsString() @MaxLength(20_000) instructions?: string
}

/**
 * Users surface - the people directory the Settings → Users page manages. Mirrors the sink/planning
 * controllers: a `usersList` tRPC query plus mutations that are also MCP tools, so the same actions
 * run from the dashboard, from agents, and from the `cli` proxy. Users are referenced by
 * initiatives.owner and tasks.assignee; deleting one unassigns it everywhere (see deleteUser).
 *
 * **This is the most privilege-dense controller in the Box**, which is why nearly all of it is
 * `@Admin()`: `user-invite-reveal` returns another person's plaintext access token, and `user-invite`
 * mints one, so a member with either could simply become an admin. They were reachable by any
 * signed-in principal from 2026-09-10 (when roles were removed) to 2026-09-13 (docs/core/AUTH.md).
 *
 * The one member-reachable write is `user-upsert` **for yourself**: a person edits their own name,
 * avatar, colour and channel handles. Editing anyone else, creating a user, or touching
 * `tailscale_login` on any row is an admin's.
 *
 * The refusals that are NOT about tiers stay where they are, because they are about the shape of
 * the admin set and about identity: you cannot delete, disable or re-tier yourself, the system
 * principal cannot be disabled; its role comes from host config. The last human admin cannot be
 * demoted, revoked or deleted.
 */
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  /**
   * tRPC query `usersList` / MCP `users-list` - every principal, ordered for display: the people
   * directory (names, identity email, channel handles, role). Any principal, like reading anything
   * else; it carries `has_token`, never a token. An agent reads who it is talking to here.
   */
  @Get('list')
  @ApiOkResponse({ type: UsersDto })
  @Trpc({ output: usersOutput })
  @Mcp({ name: 'users-list' })
  async list(): Promise<UsersDto> {
    return { generatedAt: new Date().toISOString(), users: (await readUsers()) as UserDto[] }
  }

  /** tRPC query `usersGet` / MCP `user-get` - one person's profile by id. Any principal. */
  @Post('get')
  @ApiOkResponse({ type: UserDto })
  @Trpc({ output: userOutput })
  @Mcp({ name: 'user-get' })
  async get(@Body() body: IdDto): Promise<UserDto> {
    const user = await readUser(body.id)
    if (!user) throw new BadRequestException(`unknown user "${body.id}" - users-list names every user`)
    return user as UserDto
  }

  /**
   * tRPC mutation `usersUpsert` / MCP `user-upsert` - create or partially update a user.
   *
   * Self-or-admin, checked here rather than with `@Admin()` because the answer depends on the BODY:
   * a member may edit their own profile fields and nothing else. Creating a user is an admin's, so
   * a member cannot mint themselves a second identity, and `tailscale_login`, `email` and `phone` are
   * an admin's on every row, because each decides who a person is somewhere else (a tailscale login,
   * an identity provider's sign-in, a messaging number).
   */
  @Post('upsert')
  @ApiOkResponse({ type: UserDto })
  @Trpc({ kind: 'mutation', output: userOutput })
  @Mcp({ name: 'user-upsert' })
  async upsert(@Body() body: UpsertUserDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    const isAdmin = req.principal?.role === 'admin'
    if (!isAdmin) {
      if (req.principal?.id !== body.id) throw new ForbiddenException('editing another user is admin-only')
      if (!(await readUser(body.id))) throw new ForbiddenException('creating a user is admin-only')
      if (body.tailscale_login !== undefined) throw new ForbiddenException('tailscale_login is admin-only')
      // The email is an identity (an identity provider's NameID), so changing it is an admin's. The profile form
      // always sends it, so an unchanged value passes.
      if (body.email !== undefined && !sameEmail(body.email, (await readUser(body.id))?.email)) {
        throw new ForbiddenException('changing email is admin-only')
      }
      // The phone is an identity too: a messaging channel treats its number as a team member.
      if (body.phone !== undefined && !samePhone(body.phone, (await readUser(body.id))?.phone ?? null)) {
        throw new ForbiddenException('changing phone is admin-only')
      }
      // Work capabilities bound what a person's own agent may touch; letting them widen it would
      // make the guard decorative.
      if (body.work !== undefined) throw new ForbiddenException('work is admin-only')
    }
    let channels: Record<string, string> | undefined
    try {
      channels = body.channels ? (JSON.parse(body.channels) as Record<string, string>) : undefined
    } catch {
      throw new BadRequestException('channels must be a JSON object of channel→handle')
    }
    let work: Partial<WorkAccess> | undefined
    if (body.work !== undefined) {
      try {
        const parsed: unknown = JSON.parse(body.work)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
        work = parsed as Partial<WorkAccess>
      } catch {
        throw new BadRequestException('work must be a JSON object of Work capabilities')
      }
      // Folders are checked when granted too (work-access.ts), but a path that can never be granted
      // is the admin's mistake to hear about now, not the member's at their next session.
      const paths = Array.isArray(work.folder_paths) ? work.folder_paths : []
      for (const p of paths) {
        const problem = typeof p === 'string' ? workFolderProblem(p, WORK_FS) : 'folder paths must be strings'
        if (problem) throw new BadRequestException(`work folder: ${problem}`)
      }
    }
    try {
      return (await upsertUser({ ...body, channels, work })) as User as UserDto
    } catch (e) {
      // Domain refusals (a taken email or tailscale login, an invalid id) are the caller's to fix.
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * tRPC query `usersWorkFolders` - the directories an admin could grant that complete a typed
   * path, for the Work folder picker. ADMIN-only, like setting `work`: it lists host directories.
   * The classification (work-access.ts) is the same one `usersUpsert` applies, so the picker never
   * offers what the admin could not type by hand.
   */
  @Post('work-folders')
  @ApiOkResponse({ type: WorkFoldersDto })
  @Admin()
  @Trpc({ output: workFoldersOutput })
  workFolders(@Body() body: WorkFolderQueryDto): WorkFoldersDto {
    return workFolderSuggestions(body.query, WORK_FS)
  }

  /**
   * tRPC mutation `usersWorkFolderCreate` - make one new directory for a Work grant, when its parent
   * exists and the result would be grantable. ADMIN-only; one level, never recursive.
   */
  @Post('work-folder-create')
  @ApiOkResponse({ type: WorkFolderDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: workFolderOutput })
  workFolderCreate(@Body() body: WorkFolderPathDto): WorkFolderDto {
    const path = body.path.trim()
    const problem = workFolderCreateProblem(path, WORK_FS)
    if (problem) throw new BadRequestException(`work folder: ${problem}`)
    mkdirSync(path)
    return { path }
  }

  /**
   * tRPC mutation `usersInvite` / MCP `user-invite` - mint (or ROTATE - the old link stops working)
   * ANY user's access token and return a ready-to-copy invite with the magic-link URL. Also the
   * "enable" path: issuing reactivates a disabled (revoked) user. The plaintext token is returned
   * ONCE here (stored encrypted); distribution is manual copy/paste. ADMIN-only.
   */
  @Post('invite')
  @ApiOkResponse({ type: UserInviteDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: inviteOutput })
  @Mcp({ name: 'user-invite' })
  async invite(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UserInviteDto> {
    // An agent's credential is never handed out or restored here: its sessions get their token from
    // the server, its access follows its file, and the host rotates it (`box auth token <id> --rotate`).
    if ((await readUser(body.id))?.kind === 'agent') {
      throw new BadRequestException(`"${body.id}" is an agent; agents are restored through data/config/agents/${body.id}.md, not invited`)
    }
    try {
      const token = await issuePrincipalToken(body.id, req.principal?.id)
      return this.buildInvite(token, (await readUser(body.id))!)
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * tRPC mutation `usersInviteReveal` - re-fetch the current invite (decrypts the stored token) so
   * it can be re-copied WITHOUT rotating. Empty token when none is issued (or it was revoked).
   * ADMIN-only.
   *
   * **Deliberately NOT an MCP tool** (it was one until 2026-09-15). This returns another person's
   * PERMANENT credential, so an agent holding an admin token could harvest every human's token in
   * one call - and the Box's agent principal is an admin by configuration, driven by input from
   * chat and ingested content that nobody has vetted. Removing this one door is the single biggest
   * cut to what a prompt injection can reach, and it costs nothing now that `user-link` exists:
   * an agent that needs to get someone in mints a link instead. A person wiring up their own MCP
   * client runs `box auth reveal` themselves, on the host.
   */
  @Post('invite-reveal')
  @ApiOkResponse({ type: UserInviteDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: inviteOutput })
  async inviteReveal(@Body() body: IdDto): Promise<UserInviteDto> {
    const user = await readUser(body.id)
    if (!user) throw new BadRequestException(`no user "${body.id}"`)
    return this.buildInvite((await revealPrincipalToken(body.id)) ?? '', user)
  }

  /**
   * tRPC mutation `usersAccessRevoke` / MCP `user-access-revoke` - disable ANY user: revoke their
   * token + set status 'revoked' (a live session dies on its next request). Re-enable via
   * `usersInvite`. Refuses yourself and the system principal.
   */
  @Post('access-revoke')
  @ApiOkResponse({ type: UserDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: userOutput })
  @Mcp({ name: 'user-access-revoke' })
  async accessRevoke(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    if (req.principal && req.principal.id === body.id) throw new ForbiddenException('you cannot disable yourself')
    if (body.id === systemUserId()) {
      throw new BadRequestException(`"${systemUserId()}" is the system principal - rotate its token instead of disabling it`)
    }
    const target = await readUser(body.id)
    if (!target) throw new BadRequestException(`no user "${body.id}"`)
    if (target.kind === 'agent') {
      throw new BadRequestException(`"${body.id}" is an agent - retire it by deleting data/config/agents/${body.id}.md, or rotate its token on the host`)
    }
    await assertNotLastAdmin(body.id, 'disabling them')
    await revokePrincipalToken(body.id, req.principal?.id)
    revokeAgentControl(body.id)
    return (await readUser(body.id)) as User as UserDto
  }

  /**
   * tRPC mutation `usersSetRole` / MCP `user-set-role` - move a user between the two tiers.
   *
   * The three refusals live in core (`setPrincipalRole`), not here, so they hold wherever the call
   * comes from: host config owns the system role, nobody changes their own role, and the last human
   * active admin cannot be demoted. A Box that somehow has no admin is recovered from the host with
   * `box auth token <id> --admin`.
   */
  @Post('set-role')
  @ApiOkResponse({ type: UserDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: userOutput })
  @Mcp({ name: 'user-set-role' })
  async setRole(@Body() body: SetRoleDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    try {
      await setPrincipalRole(body.id, body.role, req.principal?.id)
      if (body.role !== 'admin') revokeAgentControl(body.id)
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return (await readUser(body.id)) as User as UserDto
  }

  /**
   * tRPC mutation `usersAgentCreate` - create an agent at runtime: its file in
   * `data/config/agents/` and its principal, reconciled like a boot (core `createAgent`).
   *
   * tRPC only, no MCP tool, and only for a PERSON who is an admin at a browser session: an agent
   * (every agent is a principal, the admin system principal included) must never mint more agents,
   * and a bearer token is what an agent or a script holds. The same credential rule as approval
   * decisions (docs/AUTH.md). The new agent's engine profile stays host configuration.
   */
  @Post('agent-create')
  @ApiOkResponse({ type: UserDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: userOutput })
  async agentCreate(@Body() body: AgentCreateDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    const principal = req.principal
    if (!principal) throw new ForbiddenException('not signed in')
    if (principal.kind === 'agent' || isConfiguredAgent(principal.id)) throw new ForbiddenException('an agent cannot create agents; a person does, in Settings > Users')
    if (req.credential !== 'session') throw new ForbiddenException('agents are created by a person in Settings > Users (signed-in browser session), not with an API token')
    try {
      return (await createAgent({ id: body.id, name: body.name, role: body.role, ...(body.instructions ? { instructions: body.instructions } : {}) })) as User as UserDto
    } catch (e) {
      if (e instanceof AgentFileError) throw new BadRequestException(e.message)
      throw e
    }
  }

  /**
   * tRPC mutation `usersLink` / MCP `user-link` - mint a SHORT-LIVED, single-use sign-in link.
   *
   * This is what to hand a person who needs to get into the Box, and the one credential path an
   * agent may safely put in a transcript: it expires in minutes, it works once, and it cannot be
   * turned into an API token. Prefer it over `user-invite`, which mints the permanent credential
   * and rotates whatever the person already had.
   *
   * ADMIN-only. Minting a link for someone is, for those minutes, the power to be them.
   */
  @Post('link')
  @ApiOkResponse({ type: UserLinkDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: linkOutput })
  @Mcp({ name: 'user-link' })
  async link(@Body() body: LinkRequestDto, @Req() req: PrincipalRequest): Promise<UserLinkDto> {
    const user = await readUser(body.id)
    if (!user) throw new BadRequestException(`no user "${body.id}"`)
    const ttl = body.ttlMinutes
    if (ttl !== undefined && (ttl <= 0 || ttl > 1440)) {
      throw new BadRequestException('ttlMinutes must be between 1 and 1440 (24h)')
    }
    try {
      const { grant, claims } = await issueSigninLink(body.id, {
        actor: req.principal?.id,
        ...(ttl !== undefined && { ttlMs: ttl * 60_000 }),
      })
      const url = signinLinkUrl(grant)
      const name = user.first_name || user.nickname || user.id
      const expiresAt = new Date(claims.exp).toISOString()
      const minutes = Math.round((claims.exp - claims.iat) / 60_000)
      const message =
        `Hi ${name}, here is your sign-in link for ${boxBrand().name}:\n${url}\n\n` +
        `It works once and expires in ${minutes} minutes. If it has already expired, ask for another - ` +
        `they are free, and there is no penalty for needing a second one.`
      return { url, expiresAt, message, user: user as UserDto }
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
  }

  private buildInvite(token: string, user: User): UserInviteDto {
    // `url` is the Box's front door, NOT a credential. The old value embedded the permanent token in
    // a magic-link path, which is the thing this whole change exists to stop: the token belongs in a
    // password manager and an MCP config, never in a URL. To get someone SIGNED IN, mint a
    // short-lived link (`user-link`) instead.
    const url = appUrl()
    const name = user.first_name || user.nickname || user.id
    // Pasted straight to the person, so it carries the whole contract: one token per user, no
    // expiry, and the fact that asking for a "new" one silently kills the old.
    const keep =
      `Save it permanently (password manager, not a chat message). It never expires, so you only ` +
      `ever need this one. Each person has exactly ONE token: minting another replaces this one and ` +
      `instantly breaks every place it is already set up. Lost it? Ask for it to be re-sent, not reset.`
    const message = !token
      ? `No access token issued yet for ${user.nickname || user.id} - use Invite to mint one.`
      : `Hi ${name}, this is your ${boxBrand().name} access token. It is private - don't share it, and don't paste ` +
        `it into a chat message.\n\n` +
        `Token (for MCP/CLI setup, and for the dashboard login box at ${url}/login):\n${token}\n\n${keep}\n\n` +
        `To just sign in, ask for a sign-in link instead - those expire and are safe to send.`
    return { token, url, message, user: user as UserDto }
  }

  /** tRPC mutation `usersDelete` / MCP `user-delete` - remove a user (unassigns it everywhere).
   *  Self-deletion is refused. */
  /**
   * tRPC query `usersSidebar` - the caller's own sidebar layout (users/sidebar.ts), null for the
   * Box's default. Only ever the caller's: nobody reads or sets another person's sidebar. No MCP
   * tool: an arrangement of the web sidebar means nothing to an agent.
   */
  @Get('sidebar')
  @ApiOkResponse({ type: SidebarDto })
  @Trpc({ output: sidebarOutput })
  async sidebar(@Req() req: PrincipalRequest): Promise<SidebarDto> {
    if (!req.principal) throw new ForbiddenException('a signed-in principal is required')
    return { layout: await readSidebarLayout(req.principal.id) }
  }

  /** tRPC mutation `usersSidebarSave` - store the caller's sidebar layout; no layout restores the default. */
  @Post('sidebar-save')
  @ApiOkResponse({ type: SidebarDto })
  @Trpc({ kind: 'mutation', output: sidebarOutput })
  async sidebarSave(@Body() body: SidebarSaveDto, @Req() req: PrincipalRequest): Promise<SidebarDto> {
    if (!req.principal) throw new ForbiddenException('a signed-in principal is required')
    let layout = null
    try {
      layout = body.layout ? parseSidebarLayout(JSON.parse(body.layout)) : null
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return { layout: await writeSidebarLayout(req.principal.id, layout) }
  }

  @Post('delete')
  @ApiOkResponse({ type: UsersDto })
  @Admin()
  @Trpc({ kind: 'mutation', output: usersOutput })
  @Mcp({ name: 'user-delete' })
  async delete(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UsersDto> {
    if (req.principal && req.principal.id === body.id) throw new ForbiddenException('you cannot delete yourself')
    await assertNotLastAdmin(body.id, 'deleting them')
    try {
      await deleteUser(body.id)
      revokeAgentControl(body.id)
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return this.list()
  }
}
