import { Module } from '@nestjs/common'
import { join } from 'node:path'
import { authenticatePrincipal, boxBrand, repoRoot } from '@silkweave/box-core'
import { SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { trpc } from '@silkweave/nestjs/trpc'
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

@Module({
  imports: [
    // The SPA is not a module: main.ts serves the promoted release (and, in dev, proxies Vite) as
    // plain middleware ahead of Nest's router. See web/web-release.ts.
    // Core: what every Box has. Everything else arrives through the feature registry below.
    AuthModule,
    UsersModule,
    ChangesModule,
    OpsModule,
    AgentModule,
    SignalsModule,
    RecipesModule,
    ...SERVER_FEATURE_LIST.map((f) => f.module),
    SilkweaveModule.forRoot({
      // Evaluated when this module is imported (Nest module metadata is static), which main.ts
      // orders after the config is established; an absent box.json reads as the defaults.
      silkweave: { name: 'silkweave-box', description: `${boxBrand().name} backend`, version: '0.1.0' },
      adapters: [
        // @Trpc()-decorated controller methods → tRPC procedures under /trpc …
        trpc({ basePath: '/trpc' }),
        // … @Mcp()-decorated methods → MCP tools (Streamable HTTP) under /mcp, so the same
        // action is callable by agents and the `cli` proxy (bun run cli). The TRANSPORT itself demands
        // a valid bearer, because the per-tool @UseGuards on the @Mcp methods cannot gate
        // tools/list - that is the transport route, not a controller method - so without this an
        // anonymous client could enumerate every tool the app has. `filterActions` is the passthrough
        // hook (agent/mcp-passthrough.ts): a registered source (the mcp recipe) adds the outside MCP
        // servers' tools the caller may use; without one the list is the Box's own.
        mcp({
          basePath: '/mcp',
          filterActions: filterMcpActions,
          auth: {
            required: true,
            verifyToken: async (token: string) => {
              const p = await authenticatePrincipal(token)
              return p ? { token, sub: p.id } : undefined
            },
          },
        }),
        // … and the tRPC AppRouter type is emitted into the web app on every boot.
        // Emit as .d.ts so the consuming app's skipLibCheck ignores typegen's always-on
        // import list (avoids noUnusedLocals on TRPCMutation/Subscription for a query-only router).
        typegen({ path: join(repoRoot(), 'apps', 'web', 'src', 'generated', 'appRouter.d.ts') }),
      ],
    }),
  ],
})
export class AppModule {}
