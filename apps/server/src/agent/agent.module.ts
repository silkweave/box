import { Module } from '@nestjs/common'
import { AgentController } from './agent.controller.js'

/** The agent sidebar's REST surface (/api/agent/config). The /agent mount itself is plain express
 *  middleware registered in main.ts (agent.mount.ts) - it must run ahead of Nest's router. The
 *  agent HOST is core; the agent's seat in chat (nova answering in rooms) is the chat feature's,
 *  armed by ChatModule. */
@Module({ controllers: [AgentController] })
export class AgentModule {}
