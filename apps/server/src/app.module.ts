import { Module } from '@nestjs/common'
import { join } from 'node:path'
import { boxBrand, installMcpAuth, mcpAuthExtension, repoRoot, resolveMcpCredential } from '@silkweave/box-core'
import { SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { typegen } from '@silkweave/nestjs/typegen'
import { OpsModule } from './ops/ops.module.js'
import { UsersModule } from './users/users.module.js'
import { AgentModule } from './agent/agent.module.js'
import { AuthModule } from './auth/auth.module.js'
import { SERVER_FEATURE_LIST } from './generated/features.js'
import { ChangesModule } from './changes/changes.module.js'
import { SignalsModule } from './signals/signals.module.js'
import { RecipesModule } from './recipes/recipes.module.js'
import { filterMcpActions } from './agent/mcp-passthrough.js'
import { trpcWithSocket } from './trpc/trpc-socket.js'
import { withCallContexts } from './auth/call-context.js'
import { setHandlerRoots } from './auth/handler-map.js'

/** Core's own modules: what every Box has. Their handlers are owned by `core`. */
const CORE_MODULES = [AuthModule, UsersModule, ChangesModule, OpsModule, AgentModule, SignalsModule, RecipesModule]

// Who owns which handler (auth/handler-map.ts): core's modules, then each feature's root module.
setHandlerRoots([...CORE_MODULES.map((module) => ({ owner: 'core', module })), ...SERVER_FEATURE_LIST.map((f) => ({ owner: f.id, module: f.module }))])

// MCP sign-in (core mcp-auth.ts): at most one feature supplies the OAuth side of `/mcp`. Installed
// here, before the adapter below mounts its discovery and OAuth routes.
for (const feature of SERVER_FEATURE_LIST) if (feature.mcpAuth) installMcpAuth(feature.id, feature.mcpAuth())
const mcpOAuth = mcpAuthExtension()?.auth() ?? null

/** The tRPC transports: HTTP under /trpc, plus the live-feed WebSocket that main.ts upgrades on the same path. */
export const trpcTransport = trpcWithSocket({ basePath: '/trpc' })

@Module({
  imports: [
    // The SPA is not a module: main.ts serves the promoted release (and, in dev, proxies Vite) as
    // plain middleware ahead of Nest's router. See web/web-release.ts.
    // Core: what every Box has. Everything else arrives through the feature registry below.
    ...CORE_MODULES,
    ...SERVER_FEATURE_LIST.map((f) => f.module),
    SilkweaveModule.forRoot({
      // Evaluated when this module is imported (Nest module metadata is static), which main.ts
      // orders after the config is established; an absent box.json reads as the defaults.
      silkweave: { name: 'silkweave-box', description: `${boxBrand().name} backend`, version: '0.1.0' },
      adapters: [
        // @Trpc()-decorated controller methods → tRPC procedures under /trpc (HTTP, and a WebSocket for live subscriptions) …
        trpcTransport.adapter,
        // … @Mcp()-decorated methods → MCP tools (Streamable HTTP) under /mcp, so the same
        // action is callable by agents and the `cli` proxy (bun run cli). The TRANSPORT itself demands
        // a valid bearer, because the per-tool @UseGuards on the @Mcp methods cannot gate
        // tools/list - that is the transport route, not a controller method - so without this an
        // anonymous client could enumerate every tool the app has. `filterActions` is the passthrough
        // hook (agent/mcp-passthrough.ts): a registered source (the mcp recipe) adds the outside MCP
        // servers' tools the caller may use; without one the list is the Box's own.
        withCallContexts(mcp({
          basePath: '/mcp',
          filterActions: filterMcpActions,
          auth: {
            // The OAuth provider, resource and authorization-server URLs when the `mcp` recipe offers
            // sign-in; without it `/mcp` takes access tokens only and serves no OAuth routes.
            ...mcpOAuth,
            required: true,
            verifyToken: async (token: string) => {
              const resolved = await resolveMcpCredential(token)
              return resolved ? { token, sub: resolved.principal.id, ...(resolved.grantId && { grantId: resolved.grantId, oauthClientId: resolved.clientId }) } : undefined
            },
          },
        }), { transport: 'mcp' }),
        // … and the tRPC AppRouter type is emitted into the web app on every boot.
        // Emit as .d.ts so the consuming app's skipLibCheck ignores typegen's always-on
        // import list (avoids noUnusedLocals on TRPCMutation/Subscription for a query-only router).
        typegen({ path: join(repoRoot(), 'apps', 'web', 'src', 'generated', 'appRouter.d.ts') }),
      ],
    }),
  ],
})
export class AppModule {}
