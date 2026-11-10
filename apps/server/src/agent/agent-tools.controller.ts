import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString } from 'class-validator'
import { Trpc } from '@silkweave/nestjs'
import { deleteAgentToolset, readAgentTools, saveAgentToolset, type AgentToolsSettings } from '@silkweave/box-core'
import { AuthGuard } from '../auth/auth.guard.js'
import { Admin, type PrincipalRequest, Read } from '../auth/auth.decorators.js'
import { inputError } from '../auth/input-error.js'

// Agent tools (core agent-tools.ts): the toolsets that chat rooms and agent triggers grant to their
// sessions, and the connections (the mcp recipe's) a toolset can attach. tRPC only, never MCP, and refused for the agent principal:
// a session must not be able to widen its own grant.

class AgentToolsetInputDto {
  @ApiProperty({ description: 'Toolset id (lowercase slug)' }) @IsString() id!: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() label?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string
  @ApiProperty({ required: false, type: [String], description: 'Connection ids (the mcp recipe)' }) @IsOptional() @IsArray() @IsString({ each: true }) servers?: string[]
  @ApiProperty({ required: false, type: [String], description: 'MCP tools that run without approval' }) @IsOptional() @IsArray() @IsString({ each: true }) allow?: string[]
  @ApiProperty({ required: false, type: [String], description: 'Tools the session never gets' }) @IsOptional() @IsArray() @IsString({ each: true }) deny?: string[]
}

class AgentToolsIdDto {
  @ApiProperty() @IsString() id!: string
}

function humanOnly(req: PrincipalRequest): void {
  if (req.principal?.kind !== 'human') throw new ForbiddenException('agent tools are set by a person, not by an agent')
}

async function attempt<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw inputError(error)
  }
}

@Controller('agent-tools')
@UseGuards(AuthGuard)
export class AgentToolsController {
  @Get()
  @ApiOkResponse()
  @Trpc()
  @Admin()
  @Read()
  list(): AgentToolsSettings {
    return readAgentTools()
  }

  @Post('toolset')
  @Trpc({ kind: 'mutation' })
  @Admin()
  async toolsetSave(@Body() body: AgentToolsetInputDto, @Req() req: PrincipalRequest): Promise<AgentToolsSettings> {
    humanOnly(req)
    await attempt(() => saveAgentToolset(body))
    return readAgentTools()
  }

  @Post('toolset-delete')
  @Trpc({ kind: 'mutation' })
  @Admin()
  async toolsetDelete(@Body() body: AgentToolsIdDto, @Req() req: PrincipalRequest): Promise<AgentToolsSettings> {
    humanOnly(req)
    await attempt(() => deleteAgentToolset(body.id))
    return readAgentTools()
  }
}
