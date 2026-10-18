// The Box's own MCP tools, by the name an engine sees (`CommsSend`), found once at boot from every
// controller's and provider's `@Mcp` metadata. A session whose toolset keeps only some Box tools
// (core agent-tools.ts `boxTools`) is denied the rest by name from this list, so the list must be
// complete: an empty one refuses such a session (box-mcp.ts) rather than granting everything.

import { Injectable, type OnModuleInit } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { MCP_METADATA } from '@silkweave/nestjs'
import { mcpToolName } from '@silkweave/box-core'

let names: readonly string[] = []

/** Every Box MCP tool (engine names), sorted; empty until the server has booted. */
export function boxToolNames(): readonly string[] {
  return names
}

@Injectable()
export class BoxToolsRegistry implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const found = new Set<string>()
    for (const wrapper of [...this.discovery.getControllers(), ...this.discovery.getProviders()]) {
      const instance = wrapper.instance as object | undefined
      if (!instance || typeof instance !== 'object') continue
      const proto = Object.getPrototypeOf(instance) as object | null
      if (!proto) continue
      for (const method of this.scanner.getAllMethodNames(proto)) {
        const fn = (proto as Record<string, unknown>)[method]
        if (typeof fn !== 'function') continue
        const meta = this.reflector.get<{ name?: string } | undefined>(MCP_METADATA, fn as never)
        if (meta?.name) found.add(mcpToolName(meta.name))
      }
    }
    names = [...found].sort()
  }
}
