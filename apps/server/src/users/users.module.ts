import { Module } from '@nestjs/common'
import { UsersController } from './users.controller.js'
import { RolesController } from './roles.controller.js'

@Module({
  controllers: [UsersController, RolesController],
})
export class UsersModule {}
