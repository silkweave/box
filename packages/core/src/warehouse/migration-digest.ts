import { createHash } from 'node:crypto'
import type { Migration } from './schema.js'

export interface MigrationDump {
  name: string
  statements: string[]
  run: string | null
}

export function dumpMigration(migration: Migration): MigrationDump {
  return {
    name: migration.name,
    statements: [...(typeof migration.statements === 'function' ? migration.statements() : migration.statements ?? [])],
    run: migration.run ? createHash('sha256').update(migration.run.toString()).digest('hex') : null,
  }
}

export function migrationChecksum(dump: MigrationDump): string {
  return createHash('sha256').update(JSON.stringify([dump.name, dump.statements, dump.run])).digest('hex')
}
