import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { DEFAULT_AGENT_ENGINE, agentEnginesFor, agentProfileFor, agentProfileMapFor, agentProfilesConfigured, preferredAgentEngine, repoRoot, type Principal } from '@silkweave/box-core'
import { CurrentPrincipal } from '../auth/auth.decorators.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { agentAccountProfiles, agentWorkerUrl } from './workerdeck.host.js'

class AgentUserDto {
  @ApiProperty() id!: string
  @ApiProperty() display!: string
}

class AgentEngineDto {
  @ApiProperty({ description: "Engine id as the worker names it ('claude' | 'codex')." }) id!: string
  @ApiProperty({ description: 'Profile this user runs under on that engine.' }) profile!: string
}

class AgentConfigDto {
  @ApiProperty({ description: 'Whether the agent sidebar is available (AGENT_WORKER_URL configured).' })
  enabled!: boolean
  @ApiProperty({ description: 'Checkout directory sessions are rooted at.' }) cwd!: string
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Permission mode override; null = the worker profile decides (recommended).',
  })
  permissionMode!: string | null
  @ApiProperty({ nullable: true, type: String, description: 'Model override; null = server default.' })
  model!: string | null
  @ApiProperty({ nullable: true, type: AgentUserDto, description: 'Signed-in principal for meta.user stamping (null in transition mode).' })
  user!: AgentUserDto | null
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Claude profile this user's sessions run under; null = unmapped (or not pinned at all).",
  })
  profile!: string | null
  @ApiProperty({
    description: 'Whether this deployment pins sessions to per-user profiles (the agentProfiles map is configured).',
  })
  profileRequired!: boolean
  @ApiProperty({
    type: [AgentEngineDto],
    description:
      'Engines this user may start a session on, default first. The client sends `engine` on create; the proxy resolves the profile. Empty = unmapped.',
  })
  engines!: AgentEngineDto[]
  @ApiProperty({ description: 'Engine used when the client names none.' }) defaultEngine!: string
}

class AgentAccountDto {
  @ApiProperty() connectedAt!: string
  @ApiProperty() expiresAt!: string
}

class AgentAccountProfileDto {
  @ApiProperty({ description: 'WorkerDeck profile name, e.g. toby:claude.' }) name!: string
  @ApiProperty({ description: 'Box user the profile belongs to.' }) person!: string
  @ApiProperty({ enum: ['claude', 'codex'] }) engine!: 'claude' | 'codex'
  @ApiProperty({ nullable: true, type: String }) description!: string | null
  @ApiProperty({ description: 'Whether Settings can connect an account for it (Claude only for now).' }) connectable!: boolean
  @ApiProperty({ nullable: true, type: AgentAccountDto, description: 'The connected account; null = none (the profile uses its config dir login).' })
  account!: AgentAccountDto | null
  @ApiProperty({ nullable: true, type: Boolean, description: 'Credential probe result; null = not probed yet.' }) available!: boolean | null
  @ApiProperty({ nullable: true, type: String }) unavailableReason!: string | null
}

class AgentAccountsDto {
  @ApiProperty({ description: 'False when the agent surface is not running (box.json workerdeck).' }) enabled!: boolean
  @ApiProperty({ type: [AgentAccountProfileDto] }) profiles!: AgentAccountProfileDto[]
}

/**
 * Session-creation policy for the agent sidebar: the browser never invents paths or defaults, it
 * asks here (docs/SERVER.md §3). Any signed-in principal, member or admin: an agent session is the
 * PERSON'S own, running with their MCP token, so it is bounded by their role wherever it calls the
 * app - an admin's session can restart the service, a member's cannot (docs/core/AUTH.md § 3.4). The
 * collaborator tier this once mentioned, and AUTH_REQUIRED, are both gone.
 */
@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  @Get('config')
  @ApiOkResponse({ type: AgentConfigDto })
  config(@CurrentPrincipal() principal: Principal | null): AgentConfigDto {
    const engines = principal ? agentEnginesFor(principal.id) : []
    const byEngine = principal ? agentProfileMapFor(principal.id) : {}
    return {
      enabled: agentWorkerUrl() !== undefined,
      cwd: repoRoot(),
      // null for the same reason as `model` below: the worker owns the per-profile default, and
      // naming one here would override it for whichever engine the session lands on. The codex
      // profiles default to `acceptEdits` (Codex's "Approve for me" - workspace-write sandbox,
      // every ask flag still on); the claude profiles take the engine default. Hard-coding
      // 'default' here silently pinned every codex session to a READ-ONLY sandbox.
      permissionMode: null,
      // null on purpose, for BOTH engines. The worker owns the per-profile default
      // (`defaults.model` - gpt-5.6-luna on every :codex profile), and a model named here would
      // override it for whichever engine the session lands on - which is how a codex session ends
      // up asking for a Claude model id. Let the profile decide.
      model: null,
      user: principal ? { id: principal.id, display: principal.display } : null,
      // The default engine's profile, kept for the panel header's badge.
      profile: principal ? agentProfileFor(principal.id, preferredAgentEngine(principal.id)) : null,
      profileRequired: agentProfilesConfigured(),
      engines: engines.map((id) => ({ id, profile: byEngine[id]! })),
      defaultEngine: principal ? preferredAgentEngine(principal.id) : DEFAULT_AGENT_ENGINE,
    }
  }

  /**
   * Settings > Agent accounts: the profiles this principal may connect. A person sees their own
   * (by `person` or their agentProfiles map); an admin sees everyone's (D3). Connect and disconnect
   * themselves go to WorkerDeck's own routes through the /agent mount, where `accounts.canConnect`
   * applies the same rule (workerdeck.host.ts).
   */
  @Get('accounts')
  @ApiOkResponse({ type: AgentAccountsDto })
  async accounts(@CurrentPrincipal() principal: Principal | null): Promise<AgentAccountsDto> {
    if (!principal || agentWorkerUrl() === undefined) return { enabled: false, profiles: [] }
    const own = new Set(Object.values(agentProfileMapFor(principal.id)))
    const all = await agentAccountProfiles()
    return {
      enabled: true,
      profiles: principal.role === 'admin' ? all : all.filter((p) => p.person === principal.id || own.has(p.name)),
    }
  }
}
