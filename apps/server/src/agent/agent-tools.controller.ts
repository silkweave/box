import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator'
import { Trpc } from '@silkweave/nestjs'
import {
  deleteAgentMcpServer,
  deleteAgentToolset,
  readAgentTools,
  saveAgentMcpServer,
  saveAgentToolset,
  systemUserId,
  type AgentToolsSettings,
} from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin, type PrincipalRequest } from '../auth/auth.decorators.js'

// Agent tools (core agent-tools.ts): the MCP servers and toolsets that chat rooms and agent
// triggers grant to their sessions. tRPC only, never MCP, and refused for the agent principal:
// a session must not be able to widen its own grant.

class AgentMcpServerInputDto {
  @ApiProperty({ description: 'Server id, the tool prefix (mcp__<id>__<Tool>)' }) @IsString() id!: string
  @ApiProperty({ description: 'HTTP or SSE endpoint' }) @IsString() url!: string
  @ApiProperty({ required: false, enum: ['http', 'sse'] }) @IsOptional() @IsIn(['http', 'sse']) type?: 'http' | 'sse'
  @ApiProperty({ required: false }) @IsOptional() @IsString() label?: string
}

class AgentToolsetInputDto {
  @ApiProperty({ description: 'Toolset id (lowercase slug)' }) @IsString() id!: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() label?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) servers?: string[]
  @ApiProperty({ required: false, type: [String], description: 'MCP tools that run without approval' }) @IsOptional() @IsArray() @IsString({ each: true }) allow?: string[]
  @ApiProperty({ required: false, type: [String], description: 'Tools the session never gets' }) @IsOptional() @IsArray() @IsString({ each: true }) deny?: string[]
}

class AgentToolsIdDto {
  @ApiProperty() @IsString() id!: string
}

function humanOnly(req: PrincipalRequest): void {
  if (req.principal?.id === systemUserId()) throw new ForbiddenException('agent tools are set by a person, not by the agent')
}

function attempt<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : String(error))
  }
}

@Controller('agent-tools')
@UseGuards(AuthGuard)
export class AgentToolsController {
  @Get()
  @ApiOkResponse()
  @Trpc()
  @Admin()
  list(): AgentToolsSettings {
    return readAgentTools()
  }

  @Post('server')
  @Trpc({ kind: 'mutation' })
  @Admin()
  serverSave(@Body() body: AgentMcpServerInputDto, @Req() req: PrincipalRequest): AgentToolsSettings {
    humanOnly(req)
    attempt(() => saveAgentMcpServer(body))
    return readAgentTools()
  }

  @Post('server-delete')
  @Trpc({ kind: 'mutation' })
  @Admin()
  serverDelete(@Body() body: AgentToolsIdDto, @Req() req: PrincipalRequest): AgentToolsSettings {
    humanOnly(req)
    attempt(() => deleteAgentMcpServer(body.id))
    return readAgentTools()
  }

  @Post('toolset')
  @Trpc({ kind: 'mutation' })
  @Admin()
  toolsetSave(@Body() body: AgentToolsetInputDto, @Req() req: PrincipalRequest): AgentToolsSettings {
    humanOnly(req)
    attempt(() => saveAgentToolset(body))
    return readAgentTools()
  }

  @Post('toolset-delete')
  @Trpc({ kind: 'mutation' })
  @Admin()
  toolsetDelete(@Body() body: AgentToolsIdDto, @Req() req: PrincipalRequest): AgentToolsSettings {
    humanOnly(req)
    attempt(() => deleteAgentToolset(body.id))
    return readAgentTools()
  }
}
