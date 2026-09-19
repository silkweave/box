import { Module } from '@nestjs/common'
import { join } from 'node:path'
import { authenticatePrincipal, boxBrand, repoRoot } from '@silkweave/box-core'
import { ServeStaticModule } from '@nestjs/serve-static'
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

@Module({
  imports: [
    // Prod: serve the built SPA (apps/web/dist) on the same port as /api + /trpc + /mcp. In dev the
    // dev-proxy middleware in main.ts fully handles non-API routes (proxied to Vite) BEFORE this ever
    // runs, and a missing dist just serves nothing - so this is safe to always register. Path is
    // resolved from repoRoot (AGENTS.md marker) so it holds regardless of cwd. API base paths are
    // excluded from the static catch-all so they 404 as JSON, not index.html.
    //
    // That catch-all IS the SPA fallback the router depends on since it moved off hash routing
    // (2026-09-14): any unmatched path serves index.html, so `/crm/acme` and `/chat/general`
    // survive a refresh with no SSR and no second service. The exclude list is therefore the
    // server's half of the shared URL namespace (the client's half is in apps/web/src/router.tsx;
    // keep the two in step with RESERVED in main.ts). `/assets` is excluded for the opposite reason
    // - a stale hashed chunk requested by a tab loaded before a deploy must 404, not come back as
    // index.html with `content-type: text/html`, which the browser reports as an inscrutable module
    // parse error instead of the missing file it is.
    ServeStaticModule.forRoot({
      rootPath: join(repoRoot(), 'apps', 'web', 'dist'),
      exclude: [
        '/api',
        '/api/{*path}',
        '/trpc',
        '/trpc/{*path}',
        '/mcp',
        '/mcp/{*path}',
        '/agent',
        '/agent/{*path}',
        '/assets/{*path}',
      ],
    }),
    // Core: what every Box has. Everything else arrives through the feature registry below.
    AuthModule,
    UsersModule,
    ChangesModule,
    OpsModule,
    AgentModule,
    ...SERVER_FEATURE_LIST.map((f) => f.module),
    SilkweaveModule.forRoot({
      // Evaluated when this module is imported (Nest module metadata is static), which main.ts
      // orders after the config is established; an absent box.json reads as the defaults.
      silkweave: { name: 'silkweave-box', description: `${boxBrand().name} backend`, version: '0.1.0' },
      adapters: [
        // @Trpc()-decorated controller methods → tRPC procedures under /trpc …
        trpc({ basePath: '/trpc' }),
        // … @Mcp()-decorated methods → MCP tools (Streamable HTTP) under /mcp, so the same
        // action is callable by agents and the `cli` proxy (pnpm cli). The TRANSPORT itself demands
        // a valid bearer, because the per-tool @UseGuards on the @Mcp methods cannot gate
        // tools/list - that is the transport route, not a controller method - so without this an
        // anonymous client could enumerate every tool the app has.
        mcp({
          basePath: '/mcp',
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
