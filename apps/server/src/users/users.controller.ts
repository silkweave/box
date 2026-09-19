import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { boxBrand, systemUserId, USER_ROLES, assertNotLastAdmin, deleteUser, issuePrincipalToken, issueSigninLink, readUser, readUsers, revealPrincipalToken, revokePrincipalToken, setPrincipalRole, upsertUser, type User, type UserRole } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin } from '../auth/auth.decorators.js'
import { appUrl, signinLinkUrl } from '../auth/app-url.js'

// DTOs document the REST/Swagger surface and drive the generated tRPC input/output types, exactly
// like the sink/planning controllers. @Mcp() input fields are scalar-only so the cli proxy can build
// an option per field (no objects/nullable unions) - omit a field to leave it unchanged.
class UserDto {
  @ApiProperty() id!: string
  @ApiProperty() first_name!: string
  @ApiProperty() last_name!: string
  @ApiProperty() nickname!: string
  @ApiProperty({ required: false, nullable: true }) email!: string | null
  @ApiProperty({ required: false, nullable: true }) image!: string | null
  @ApiProperty({ required: false, nullable: true }) color!: string | null
  @ApiProperty({ description: 'Access lifecycle: active | invited | revoked' })
  status!: string
  @ApiProperty({ enum: USER_ROLES, description: 'Trust tier: admin | member (docs/core/AUTH.md § 3)' })
  role!: string
  @ApiProperty({ required: false, nullable: true, description: 'Tailscale login this user signs in as, when the Box runs behind tailscale serve' })
  tailscale_login!: string | null
  @ApiProperty({ type: Object, description: 'channel → handle map' })
  channels!: Record<string, string>
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
  @ApiProperty({ required: false, description: 'Reference-only contact email ("" clears it)' })
  @IsOptional() @IsString() email?: string
  @ApiProperty({ required: false, description: 'Avatar image URL or data: URI ("" clears it)' })
  @IsOptional() @IsString() image?: string
  @ApiProperty({ required: false, description: "Swatch name ('indigo', 'cyan', …; '' clears it)" })
  @IsOptional() @IsString() color?: string
  @ApiProperty({ required: false, description: 'JSON object of channel→handle - the source of truth for per-person presence' })
  @IsOptional() @IsString() channels?: string
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sort?: number
  @ApiProperty({ required: false, description: 'ADMIN-only: the tailscale login this user signs in as ("" clears it)' })
  @IsOptional() @IsString() tailscale_login?: string
}
class SetRoleDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty({ enum: USER_ROLES, description: 'admin grants the credential and service surfaces; member is everything else' })
  @IsIn(USER_ROLES) role!: UserRole
}
class IdDto {
  @ApiProperty() @IsString() id!: string
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
  principal?: { id: string; role?: string } | null
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
  /** tRPC query `usersList` - every principal, ordered for display. */
  @Get('list')
  @ApiOkResponse({ type: UsersDto })
  @Trpc()
  async list(): Promise<UsersDto> {
    return { generatedAt: new Date().toISOString(), users: (await readUsers()) as UserDto[] }
  }

  /**
   * tRPC mutation `usersUpsert` / MCP `user-upsert` - create or partially update a user.
   *
   * Self-or-admin, checked here rather than with `@Admin()` because the answer depends on the BODY:
   * a member may edit their own profile fields and nothing else. Creating a user is an admin's, so
   * a member cannot mint themselves a second identity, and `tailscale_login` is an admin's on every
   * row, because it is the mapping that decides who a tailscale login signs in as.
   */
  @Post('upsert')
  @ApiOkResponse({ type: UserDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'user-upsert' })
  async upsert(@Body() body: UpsertUserDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    const isAdmin = req.principal?.role === 'admin'
    if (!isAdmin) {
      if (req.principal?.id !== body.id) throw new ForbiddenException('editing another user is admin-only')
      if (!(await readUser(body.id))) throw new ForbiddenException('creating a user is admin-only')
      if (body.tailscale_login !== undefined) throw new ForbiddenException('tailscale_login is admin-only')
    }
    let channels: Record<string, string> | undefined
    try {
      channels = body.channels ? (JSON.parse(body.channels) as Record<string, string>) : undefined
    } catch {
      throw new BadRequestException('channels must be a JSON object of channel→handle')
    }
    return (await upsertUser({ ...body, channels })) as User as UserDto
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
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'user-invite' })
  async invite(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UserInviteDto> {
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
  @Trpc({ kind: 'mutation' })
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
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'user-access-revoke' })
  async accessRevoke(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    if (req.principal && req.principal.id === body.id) throw new ForbiddenException('you cannot disable yourself')
    if (body.id === systemUserId()) {
      throw new BadRequestException(`"${systemUserId()}" is the system principal - rotate its token instead of disabling it`)
    }
    if (!(await readUser(body.id))) throw new BadRequestException(`no user "${body.id}"`)
    await assertNotLastAdmin(body.id, 'disabling them')
    await revokePrincipalToken(body.id, req.principal?.id)
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
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'user-set-role' })
  async setRole(@Body() body: SetRoleDto, @Req() req: PrincipalRequest): Promise<UserDto> {
    try {
      await setPrincipalRole(body.id, body.role, req.principal?.id)
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return (await readUser(body.id)) as User as UserDto
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
  @Trpc({ kind: 'mutation' })
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
  @Post('delete')
  @ApiOkResponse({ type: UsersDto })
  @Admin()
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'user-delete' })
  async delete(@Body() body: IdDto, @Req() req: PrincipalRequest): Promise<UsersDto> {
    if (req.principal && req.principal.id === body.id) throw new ForbiddenException('you cannot delete yourself')
    await assertNotLastAdmin(body.id, 'deleting them')
    try {
      await deleteUser(body.id)
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : String(e))
    }
    return this.list()
  }
}
