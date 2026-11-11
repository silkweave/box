import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard.js'
import { type PrincipalRequest, Admin, Read, Resource } from '../auth/auth.decorators.js'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import { assertKnownUser, computeSignalAggregates, trackerCatalogue, deleteSignalDefinition, deleteSignalPoint, floorSignalBucket, mergeSignalPoints, SIGNAL_ACCUMULATIONS, SIGNAL_DIRECTIONS, SIGNAL_INTERVALS, SIGNAL_SOURCES, readAllSignalPointRecords, readDataSources, readSignalDefinition, readSignalDefinitions, readSignalOwnersFile, readSignalPointRecords, readSignalPoints, recordSignalIncrement, signalReferences, setSignalArchived, resolveSignalHistory, renameSignalDefinition, resolveSignalOwner, serializeBucket, setSignalPoint, setSignalPoints, SUBDAILY_WINDOW_DAYS, upsertSignalDefinition, writeSignalOwnersFile, type SignalAccumulation, type SignalDefinition, type SignalDirection, type MergedSignalPoint, type SignalInterval, type SignalPointRecord, type SignalSource } from '@silkweave/box-core'
import { inputError } from '../auth/input-error.js'

// DTOs document the REST/Swagger surface and drive the generated tRPC output type. The dashboard
// keeps its own SignalsData type and casts the result; runtime shape is a superset of the old
// signals.json (the definition fields ride along per signal since phase B1).
class SignalPointDto {
  @ApiProperty() date!: string
  @ApiProperty() value!: number
}
/**
 * Period aggregates over the FULL point store (both stores, un-windowed) - deliberately NOT
 * derivable from `points[]`, which is trimmed to SUBDAILY_WINDOW_DAYS for sub-daily charts.
 * increment: SUM of the buckets in the window; snapshot: the LAST value in the window.
 * Null = no data in the window (honest, never a fabricated 0).
 */
class SignalAggregatesDto {
  @ApiProperty({ nullable: true, type: Number, description: 'Every bucket ever (for a snapshot signal: the latest value)' })
  all_time!: number | null
  @ApiProperty({ nullable: true, type: Number, description: 'The last complete UTC day [yesterday 00:00Z, today 00:00Z)' })
  yesterday!: number | null
  @ApiProperty({ nullable: true, type: Number, description: 'From the 1st of the current UTC month, today-so-far included' })
  month_to_date!: number | null
  @ApiProperty({ nullable: true, type: Number, description: 'The 7 complete UTC days before today (today-so-far excluded)' })
  last_7d!: number | null
}
class SignalDto {
  @ApiProperty() id!: string
  @ApiProperty() channel!: string
  @ApiProperty({ description: 'The owning area (a Box tracker\'s feature, `signals` for a data-source or hand-typed signal, a feature\'s own signal\'s area): write on it edits the signal and its points' })
  area!: string
  @ApiProperty() label!: string
  @ApiProperty() group!: string
  @ApiProperty({ required: false }) unit?: string
  @ApiProperty({ required: false, nullable: true, description: 'Owning users.id (definition first, then the signal-owner settings)' })
  owner!: string | null
  @ApiProperty() interval!: string
  @ApiProperty() accumulation!: string
  @ApiProperty() source!: string
  @ApiProperty() direction!: string
  @ApiProperty() description!: string
  @ApiProperty({ type: [String] }) depends_on!: string[]
  @ApiProperty({ required: false, nullable: true, description: 'The data source whose sync owns this signal\'s live points (null = not connected)' })
  data_source_id!: string | null
  @ApiProperty({ required: false, nullable: true, description: 'The provider tracker this signal subscribes to, or (with no data_source_id) the Box tracker that computes it' })
  tracker_key!: string | null
  @ApiProperty({ type: Object, description: "A Box tracker's parameter values ({} otherwise)" })
  tracker_params!: Record<string, string>
  @ApiProperty({ required: false, nullable: true, description: 'The formula this signal is computed from (null = an ordinary signal)' })
  formula!: string | null
  @ApiProperty({ type: [Number], description: 'Levels that record a signal.threshold event when reached or crossed upward, ascending' })
  thresholds!: number[]
  @ApiProperty({ required: false, nullable: true, type: String, description: 'When the signal was archived (signal-archive), or null' })
  archived_at!: string | null
  @ApiProperty({ type: SignalAggregatesDto, description: 'Period aggregates from the full store - see SignalAggregatesDto' })
  aggregates!: SignalAggregatesDto
  @ApiProperty({ type: [SignalPointDto] }) points!: SignalPointDto[]
}
/** The connection health a chart needs to render "synced 2026-08-10" next to a connected signal -
 *  a superset of the old payload, so existing consumers see nothing they must handle. */
class SignalDataSourceDto {
  @ApiProperty() id!: string
  @ApiProperty() provider!: string
  @ApiProperty() label!: string
  @ApiProperty() status!: string
  @ApiProperty({ required: false, nullable: true }) last_sync_at!: string | null
  @ApiProperty({ required: false, nullable: true }) last_sync_status!: string | null
}
class SignalsDataDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [String] }) dates!: string[]
  @ApiProperty({ type: [String] }) channels!: string[]
  @ApiProperty({ type: [SignalDto] }) signals!: SignalDto[]
  @ApiProperty({ type: [SignalDataSourceDto], description: 'Every data source, for resolving a signal\' data_source_id' })
  sources!: SignalDataSourceDto[]
}

class SignalDefinitionDto {
  @ApiProperty() id!: string
  @ApiProperty({ description: 'The owning area: write on it edits the signal and its points' })
  area!: string
  @ApiProperty() label!: string
  @ApiProperty() signal_group!: string
  @ApiProperty({ required: false, nullable: true }) unit!: string | null
  @ApiProperty() channel!: string
  @ApiProperty() source!: string
  @ApiProperty() interval!: string
  @ApiProperty() accumulation!: string
  @ApiProperty() direction!: string
  @ApiProperty({ required: false, nullable: true }) owner!: string | null
  @ApiProperty() description!: string
  @ApiProperty({ type: [String] }) depends_on!: string[]
  @ApiProperty({ required: false, nullable: true }) data_source_id!: string | null
  @ApiProperty({ required: false, nullable: true }) tracker_key!: string | null
  @ApiProperty({ type: Object, description: "A Box tracker's parameter values ({} otherwise)" })
  tracker_params!: Record<string, string>
  @ApiProperty({ required: false, nullable: true, description: 'The formula this signal is computed from (null = an ordinary signal)' })
  formula!: string | null
  @ApiProperty({ type: [Number] }) thresholds!: number[]
  @ApiProperty() sort!: number
  @ApiProperty({ required: false, nullable: true, type: String, description: 'When the signal was archived (signal-archive), or null' })
  archived_at!: string | null
  @ApiProperty() created_at!: string
  @ApiProperty() updated_at!: string
  @ApiProperty({ required: false, nullable: true }) created_by!: string | null
  @ApiProperty({ required: false, nullable: true }) updated_by!: string | null
}
class TrackerOptionDto {
  @ApiProperty() value!: string
  @ApiProperty() label!: string
}
class TrackerParamDto {
  @ApiProperty() key!: string
  @ApiProperty() label!: string
  @ApiProperty({ enum: ['enum', 'text', 'date', 'user'] }) kind!: string
  @ApiProperty({ type: [TrackerOptionDto], description: 'enum params: the allowed values (resolved now); [] otherwise' })
  options!: TrackerOptionDto[]
  @ApiProperty() required!: boolean
  @ApiProperty() description!: string
}
class TrackerDto {
  @ApiProperty({ enum: ['box', 'source'], description: "box: computed from Box data (bind tracker_key + tracker_params). source: fed by a data source's sync (bind data_source_id + tracker_key)" })
  origin!: string
  @ApiProperty({ description: "The tracker_key a signal binds: <feature>.<name> for a Box tracker, the provider's token for a source one" }) key!: string
  @ApiProperty() label!: string
  @ApiProperty({ required: false, nullable: true }) unit!: string | null
  @ApiProperty() interval!: string
  @ApiProperty() accumulation!: string
  @ApiProperty() direction!: string
  @ApiProperty() group!: string
  @ApiProperty() description!: string
  @ApiProperty({ type: [TrackerParamDto] }) params!: TrackerParamDto[]
  @ApiProperty({ required: false, nullable: true, description: 'Source trackers: the data source that feeds it' }) data_source_id!: string | null
  @ApiProperty({ required: false, nullable: true }) data_source_label!: string | null
  @ApiProperty({ required: false, nullable: true }) provider!: string | null
}
class TrackersDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [TrackerDto] }) trackers!: TrackerDto[]
}

class SignalDefinitionsDto {
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [SignalDefinitionDto] }) definitions!: SignalDefinitionDto[]
}
class SignalDeleteReportDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: [String], description: 'Signal ids whose depends_on lists were pruned' }) pruned_from!: string[]
  @ApiProperty({ type: [String], description: 'Boards the signal was placed on (the placement was pruned)' })
  pruned_from_boards!: string[]
  @ApiProperty({ type: [String], description: 'Initiatives still binding the id (left in place)' }) bound_initiatives!: string[]
  @ApiProperty({ type: [String] }) warnings!: string[]
}

class OwnersDto {
  @ApiProperty({ type: Object, description: 'channel → users.id default' }) channels!: Record<string, string>
  @ApiProperty({ type: Object, description: 'signal_id → users.id override (null = deliberately unowned)' })
  signals!: Record<string, string | null>
}

const OWNER_SCOPES = ['channel', 'signal'] as const
type OwnerScope = (typeof OWNER_SCOPES)[number]

// NOTE: @Mcp() input fields must stay scalar (see the planning controller note). `unowned` marks a
// signal explicitly ownerless (distinct from removing the override, which falls back to the
// channel default) - omit both `owner` and `unowned` to remove the mapping.
class SetOwnerDto {
  @ApiProperty({ enum: OWNER_SCOPES, description: 'Set a channel default or a per-signal override' })
  @IsIn(OWNER_SCOPES) scope!: OwnerScope
  @ApiProperty({ description: 'The channel name or signals.signal_id (per scope)' }) @IsString() key!: string
  @ApiProperty({ required: false, description: 'users.id to own it; omit to remove the mapping' })
  @IsOptional() @IsString() owner?: string
  @ApiProperty({ required: false, description: 'signal scope only: true = explicitly unowned (brand-level)' })
  @IsOptional() @IsBoolean() unowned?: boolean
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

// Same @Mcp() scalar-inputs constraint as the planning DTOs: nullable text fields accept '' as
// "clear it". Omitting any field leaves the stored value alone.
class UpsertSignalDto {
  @ApiProperty({ description: 'Signal id = the signal id (one namespace with signals.signal_id). Plain slug for curated signals, e.g. mrr' })
  @IsString() id!: string
  @ApiProperty({ required: false, description: 'Display name (curation - read paths prefer it over derived row labels)' })
  @IsOptional() @IsString() label?: string
  @ApiProperty({ required: false, description: 'Dashboard section within the channel, e.g. Finance' })
  @IsOptional() @IsString() signal_group?: string
  @ApiProperty({ required: false, description: "Display unit ('' clears)" }) @IsOptional() @IsString() unit?: string
  @ApiProperty({ required: false, description: "Dashboard channel; defaults to 'business' for source-less signals" })
  @IsOptional() @IsString() channel?: string
  @ApiProperty({ required: false, enum: SIGNAL_SOURCES, description: 'derived = auto-registered by the derive machinery; manual = human-created. Defaults to manual on create; pass derived when registering an existing derived signal by hand' })
  @IsOptional() @IsIn(SIGNAL_SOURCES) source?: SignalSource
  @ApiProperty({ required: false, enum: SIGNAL_INTERVALS, description: 'Bucket width of one point' })
  @IsOptional() @IsIn(SIGNAL_INTERVALS) interval?: SignalInterval
  @ApiProperty({ required: false, enum: SIGNAL_ACCUMULATIONS, description: 'snapshot = whole value at that time; increment = occurrences per bucket' })
  @IsOptional() @IsIn(SIGNAL_ACCUMULATIONS) accumulation?: SignalAccumulation
  @ApiProperty({ required: false, enum: SIGNAL_DIRECTIONS, description: 'Is up good? (churn: down)' })
  @IsOptional() @IsIn(SIGNAL_DIRECTIONS) direction?: SignalDirection
  @ApiProperty({ required: false, description: "Owning users.id ('' clears → the signal-owner settings decide)" })
  @IsOptional() @IsString() owner?: string
  @ApiProperty({ required: false, description: 'Free text: what the number means, how it is gathered' })
  @IsOptional() @IsString() description?: string
  @ApiProperty({ required: false, type: [String], description: 'Signal ids this one is driven by (must exist, no cycles)' })
  @IsOptional() @IsArray() @IsString({ each: true }) depends_on?: string[]
  @ApiProperty({ required: false, description: "Connect this signal to a data source (data-sources); needs tracker_key too. '' with a tracker_key binds a Box tracker instead; '' without one unbinds" })
  @IsOptional() @IsString() data_source_id?: string
  @ApiProperty({ required: false, description: "With data_source_id: the provider's tracker key, verbatim (providers-list), e.g. FIRST_MESSAGE. Alone: a Box tracker key (trackers-list), e.g. planning.tasks_done; the signal becomes derived and the tracker computes its points. '' unbinds (a provider's points stay; a Box tracker's go)" })
  @IsOptional() @IsString() tracker_key?: string
  @ApiProperty({ required: false, description: 'Box trackers only: JSON object string of parameter values, e.g. {"kind":"oss-pr"} (trackers-list names each param). Replaces the stored values' })
  @IsOptional() @IsString() tracker_params?: string
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    description:
      "Make this a FORMULA signal: its points are computed on read from other signals. '' or null clears it (depends_on is then kept as is). " +
      "Language: numbers, + - * /, unary minus, parentheses, and signal ids. A bare id is [a-z0-9_.@-] starting with a letter; '-' is an id character, " +
      'so write binary minus with spaces (a - b); quote ids a bare token cannot spell ("npm.pkg.@acme/core"). ' +
      "x = x aggregated into this signal's interval bucket (sum for increment inputs, last value for snapshot inputs); " +
      'start(x) = the level entering the bucket (x\'s latest bucket that ended on or before the bucket start); prev(x) = x in the previous bucket. ' +
      'A missing input, division by zero or a non-finite result gives no point (never 0). depends_on is set to the formula\'s signal ids (must exist, no cycles). ' +
      'Only for manual, unconnected signals. A manual point (signal-point-set) on a formula signal overrides the computed value of its bucket. ' +
      'Example: churned-mrr / start(mrr) * 100',
  })
  @IsOptional() @IsString() formula?: string | null
  @ApiProperty({ required: false, type: [Number], description: 'Replaces the threshold levels (signal.threshold events when reached or crossed upward); [] clears' })
  @IsOptional() @IsArray() @IsNumber({}, { each: true }) thresholds?: number[]
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sort?: number
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class RenameSignalDto {
  @ApiProperty({ description: 'Current signal id' }) @IsString() id!: string
  @ApiProperty({ description: 'New signal id (cascades to every binding; refused for derived signals)' })
  @IsString() new_id!: string
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class SignalListQueryDto {
  @ApiProperty({ required: false, type: Boolean, description: 'Include archived signals (default false: archived signals are left out of the list)' })
  @IsOptional() include_archived?: boolean
}

class SignalReferencesQueryDto {
  @ApiProperty({ description: 'Signal id' }) @IsString() id!: string
}
class SignalReferenceDto {
  @ApiProperty({ description: 'What it is: goal, task, trigger' }) kind!: string
  @ApiProperty({ description: "Its id in the owning feature" }) id!: string
  @ApiProperty({ description: 'What a person calls it (a goal title, a trigger name)' }) label!: string
  @ApiProperty({ description: 'How it uses the signal: goal measure, milestone measure, trigger filter' }) via!: string
  @ApiProperty({ nullable: true, type: String, description: 'App URL that opens it, or null' }) href!: string | null
}
class SignalReferencesDto {
  @ApiProperty() id!: string
  @ApiProperty({ type: [SignalReferenceDto] }) references!: SignalReferenceDto[]
}

class ArchiveSignalDto {
  @ApiProperty({ description: 'Signal id' }) @IsString() id!: string
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

/** A REST query delivers 'true' as a string; tRPC and MCP deliver a boolean. */
const flag = (v: unknown): boolean => v === true || v === 'true'

class DeleteSignalDto {
  @ApiProperty({ description: 'Signal id to delete (its data points are deleted with it)' })
  @IsString() id!: string
  @ApiProperty({ required: false, description: 'users.id performing this mutation (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

// --- the points surface (phase B2) ---------------------------------------------------------------
// Manual point entry is operational data entry, not configuration: no @Admin() (any
// authenticated internal user, the planning-mutation precedent) - the audit trail carries
// accountability, so `actor` should be the real human (over the Box's MCP surface the principal
// defaults to the nova service account).

class SignalSeriesListDto {
  @ApiProperty({ description: 'Signal id whose series to read' }) @IsString() signal_id!: string
  @ApiProperty({ required: false, description: 'Clip the window: buckets >= floor(from). ISO 8601; offset-less = UTC' })
  @IsOptional() @IsString() from?: string
}

class SignalSeriesPointDto {
  @ApiProperty({ description: "Bucket start - 'YYYY-MM-DD' at day+ grain, a full ISO timestamp below it" }) date!: string
  @ApiProperty() value!: number
  @ApiProperty({ enum: ['live', 'backfill', 'manual'], description: 'Which class won this bucket' }) source!: string
  @ApiProperty({ required: false, description: 'Formula signals: true when the value was computed from the formula (a manual point overrides it)' })
  computed?: boolean
}

class SignalSeriesDto {
  @ApiProperty() signal_id!: string
  @ApiProperty() label!: string
  @ApiProperty() channel!: string
  @ApiProperty() interval!: string
  @ApiProperty() accumulation!: string
  @ApiProperty({ required: false, nullable: true }) unit!: string | null
  @ApiProperty() generatedAt!: string
  @ApiProperty() count!: number
  @ApiProperty({ type: [SignalSeriesPointDto], description: 'The MERGED history across both point stores, ascending' })
  points!: SignalSeriesPointDto[]
}

class SignalPointsListDto {
  @ApiProperty({ description: 'Signal id whose points to list' }) @IsString() signal_id!: string
}

class SetSignalPointDto {
  @ApiProperty({ description: 'Signal id (must be registered - signal-upsert first)' }) @IsString() signal_id!: string
  @ApiProperty({ description: "When the observation is for. ISO 8601; offset-less = UTC; date-only = UTC midnight. Floored to the signal's interval bucket" })
  @IsString() at!: string
  @ApiProperty({ description: 'The observed value (for increment signals: a hand-corrected bucket total, overridden while live data occupies the bucket)' })
  @IsNumber() value!: number
  @ApiProperty({ required: false, description: "Free-text provenance note ('' clears; omit to keep)" })
  @IsOptional() @IsString() note?: string
  @ApiProperty({ required: false, description: 'users.id performing this entry (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class DeleteSignalPointDto {
  @ApiProperty({ description: 'Signal id' }) @IsString() signal_id!: string
  @ApiProperty({ description: 'Any time inside the bucket to clear (floored like signal-point-set)' })
  @IsString() at!: string
  @ApiProperty({ required: false, description: 'Accepted for tool-surface uniformity; a delete leaves no row to stamp' })
  @IsOptional() @IsString() actor?: string
}

class SetSignalPointsDto {
  @ApiProperty({ description: 'Signal id (must be registered)' }) @IsString() signal_id!: string
  @ApiProperty({ description: `JSON array string of points, e.g. [{"at":"2025-09-01","value":118000,"note":"bank stmt"}] - the bulk manual path (all-or-nothing; last entry wins a shared bucket)` })
  @IsString() points!: string
  @ApiProperty({ required: false, description: 'users.id performing this entry (audit stamp; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class SignalEventDto {
  @ApiProperty({ description: "Increment signal id to count an occurrence into (accumulation: 'increment' only)" })
  @IsString() signal_id!: string
  @ApiProperty({ required: false, description: 'Occurrence time (ISO; offset-less = UTC). Defaults to now' })
  @IsOptional() @IsString() at?: string
  @ApiProperty({ required: false, description: 'Idempotency key - the same occurrence fired twice with one key counts 1. Scoped per signal server-side; generated when omitted (every call then counts)' })
  @IsOptional() @IsString() dedup_key?: string
  @ApiProperty({ required: false, description: 'users.id recording the occurrence (lands on the event; defaults to the authenticated principal)' })
  @IsOptional() @IsString() actor?: string
}

class SignalPointRowDto {
  @ApiProperty({ description: 'ISO-Z start of the interval bucket' }) bucket!: string
  @ApiProperty() value!: number
  @ApiProperty({ required: false, nullable: true }) note!: string | null
  @ApiProperty({ required: false, nullable: true, description: 'The live value currently overriding this manual point (null = the manual value is what renders). Shadowed points resurface if the live source retreats' })
  shadowed_by!: number | null
  @ApiProperty({ required: false, nullable: true, description: 'Formula signals: the computed value this manual correction overrides (null = nothing computed for the bucket). Deleting the point brings it back' })
  overrides_computed!: number | null
  @ApiProperty() updated_at!: string
  @ApiProperty({ required: false, nullable: true }) created_by!: string | null
  @ApiProperty({ required: false, nullable: true }) updated_by!: string | null
}
class SignalPointsDto {
  @ApiProperty() signal_id!: string
  @ApiProperty() interval!: string
  @ApiProperty() accumulation!: string
  @ApiProperty() generatedAt!: string
  @ApiProperty({ type: [SignalPointRowDto], description: 'The MANUAL points only (the durable, hand-entered rows) - live buckets appear only as shadowed_by, so this is EMPTY for a purely-live signal. For the merged series use signal-series.' })
  points!: SignalPointRowDto[]
}

class SignalEventResultDto {
  @ApiProperty() signal_id!: string
  @ApiProperty({ description: 'False when the dedup_key was already recorded - nothing was counted' }) fresh!: boolean
  @ApiProperty({ description: 'The bucket the occurrence falls in' }) bucket!: string
  @ApiProperty({ description: "The bucket's live count after the re-derive" }) value!: number
}


// tRPC output types: reflection reads one level deep, so responses with nested DTOs get a Zod
// schema mirroring the DTOs below (type-only; the response is not validated against it).
const signalDefinitionOutput = z.object({
  id: z.string(), area: z.string(), label: z.string(), signal_group: z.string(), unit: z.string().nullable(),
  channel: z.string(), source: z.string(), interval: z.string(), accumulation: z.string(), direction: z.string(),
  owner: z.string().nullable(), description: z.string(), depends_on: z.array(z.string()),
  data_source_id: z.string().nullable(), tracker_key: z.string().nullable(), tracker_params: z.record(z.string(), z.string()),
  formula: z.string().nullable(), thresholds: z.array(z.number()), sort: z.number(), archived_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), created_by: z.string().nullable(), updated_by: z.string().nullable(),
})
const signalsDataOutput = z.object({
  generatedAt: z.string(), dates: z.array(z.string()), channels: z.array(z.string()),
  signals: z.array(z.object({
    id: z.string(), channel: z.string(), area: z.string(), label: z.string(), group: z.string(), unit: z.string().optional(),
    owner: z.string().nullable(), interval: z.string(), accumulation: z.string(), source: z.string(), direction: z.string(),
    description: z.string(), depends_on: z.array(z.string()), data_source_id: z.string().nullable(), tracker_key: z.string().nullable(),
    tracker_params: z.record(z.string(), z.string()), formula: z.string().nullable(), thresholds: z.array(z.number()),
    archived_at: z.string().nullable(),
    aggregates: z.object({ all_time: z.number().nullable(), yesterday: z.number().nullable(), month_to_date: z.number().nullable(), last_7d: z.number().nullable() }),
    points: z.array(z.object({ date: z.string(), value: z.number() })),
  })),
  sources: z.array(z.object({
    id: z.string(), provider: z.string(), label: z.string(), status: z.string(),
    last_sync_at: z.string().nullable(), last_sync_status: z.string().nullable(),
  })),
})
const signalDefinitionsOutput = z.object({ generatedAt: z.string(), definitions: z.array(signalDefinitionOutput) })
const trackersOutput = z.object({
  generatedAt: z.string(),
  trackers: z.array(z.object({
    origin: z.enum(['box', 'source']), key: z.string(), label: z.string(), unit: z.string().nullable(), interval: z.string(),
    accumulation: z.string(), direction: z.string(), group: z.string(), description: z.string(),
    params: z.array(z.object({
      key: z.string(), label: z.string(), kind: z.enum(['enum', 'text', 'date', 'user']),
      options: z.array(z.object({ value: z.string(), label: z.string() })), required: z.boolean(), description: z.string(),
    })),
    data_source_id: z.string().nullable(), data_source_label: z.string().nullable(), provider: z.string().nullable(),
  })),
})
const signalReferencesOutput = z.object({
  id: z.string(),
  references: z.array(z.object({ kind: z.string(), id: z.string(), label: z.string(), via: z.string(), href: z.string().nullable() })),
})
const ownersOutput = z.object({ channels: z.record(z.string(), z.string()), signals: z.record(z.string(), z.string().nullable()) })
const signalSeriesOutput = z.object({
  signal_id: z.string(), label: z.string(), channel: z.string(), interval: z.string(), accumulation: z.string(),
  unit: z.string().nullable(), generatedAt: z.string(), count: z.number(),
  points: z.array(z.object({ date: z.string(), value: z.number(), source: z.enum(['live', 'backfill', 'manual']), computed: z.boolean().optional() })),
})
const signalPointsOutput = z.object({
  signal_id: z.string(), interval: z.string(), accumulation: z.string(), generatedAt: z.string(),
  points: z.array(z.object({
    bucket: z.string(), value: z.number(), note: z.string().nullable(), shadowed_by: z.number().nullable(),
    overrides_computed: z.number().nullable(), updated_at: z.string(), created_by: z.string().nullable(), updated_by: z.string().nullable(),
  })),
})

@Resource('signal')
@Controller('signals')
@UseGuards(AuthGuard)
export class SignalsController {

  /**
   * tRPC query `signalsData` - the full cross-channel signal payload in one round-trip: one entry
   * per definition (data-less ones ship with `points: []`, which lets a picker offer a signal before
   * its source exists). History is the per-bucket merge of `signal_points` (core
   * mergeSignalPoints). `points[].date` is 'YYYY-MM-DD' at day+ grain; sub-daily buckets ship a
   * full ISO timestamp in the same field and are windowed to the trailing SUBDAILY_WINDOW_DAYS.
   * The global `dates[]` axis is derived from daily-grain signals only.
   */
  @Get()
  @ApiOkResponse({ type: SignalsDataDto })
  @Trpc({ output: signalsDataOutput })
  @Read()
  async data(@Query() query: SignalListQueryDto = {}): Promise<SignalsDataDto> {
    const [allDefinitions, pointRows, sourceRows] = await Promise.all([readSignalDefinitions(), readAllSignalPointRecords(), readDataSources()])
    // Archived signals are left out unless asked for. Formulas still resolve against every
    // definition (an archived input keeps a live formula computing).
    const definitions = flag(query?.include_archived) ? allDefinitions : allDefinitions.filter((d) => !d.archived_at)
    // Ownership resolves per signal at read time: definition.owner first, then the signal-owner
    // settings (read fresh - edits are instant).
    const owners = readSignalOwnersFile()

    const pointsById = new Map<string, SignalPointRecord[]>()
    for (const p of pointRows) {
      let list = pointsById.get(p.signal_id)
      if (!list) pointsById.set(p.signal_id, (list = []))
      list.push(p)
    }
    const subDailyFrom = new Date(Date.now() - SUBDAILY_WINDOW_DAYS * 86_400_000).toISOString()
    // Formula signals compute on read from the same in-memory rows (signals/formula.ts); one memo
    // so a formula read by another formula resolves once.
    const defById = new Map(allDefinitions.map((d) => [d.id, d]))
    const history = {
      memo: new Map<string, MergedSignalPoint[]>(),
      source: {
        definition: (id: string) => defById.get(id),
        stored: (id: string) => ({ points: pointsById.get(id) ?? [] }),
      },
    }

    const dates = new Set<string>()
    const signalById = new Map<string, SignalDto>()
    for (const d of definitions) {
      // Aggregates come from the FULL merge; the SUBDAILY_WINDOW_DAYS trim applies ONLY to the
      // served chart points. Summing the trimmed array instead would silently under-report
      // all_time for any sub-daily signal - the one trap of this layer (signals/aggregate.ts).
      const full = d.formula ? resolveSignalHistory(d.id, history.source, history.memo) : mergeSignalPoints(d, pointsById.get(d.id) ?? [])
      const aggregates = computeSignalAggregates(d, full)
      const merged =
        d.interval !== 'hour'
          ? full
          : d.formula
            ? full.filter((p) => p.bucket >= floorSignalBucket(subDailyFrom, 'hour'))
            : mergeSignalPoints(d, pointsById.get(d.id) ?? [], { from: subDailyFrom })
      const points = merged.map((p) => ({ date: serializeBucket(p.bucket, d.interval), value: p.value }))
      if (d.interval === 'day') for (const p of points) dates.add(p.date)
      signalById.set(d.id, {
        id: d.id,
        channel: d.channel,
        area: d.area,
        label: d.label,
        group: d.signal_group,
        unit: d.unit ?? undefined,
        owner: d.owner ?? resolveSignalOwner(owners, d.channel, d.id),
        interval: d.interval,
        accumulation: d.accumulation,
        source: d.source,
        direction: d.direction,
        description: d.description,
        depends_on: d.depends_on,
        data_source_id: d.data_source_id,
        tracker_key: d.tracker_key,
        tracker_params: d.tracker_params,
        formula: d.formula,
        thresholds: d.thresholds,
        archived_at: d.archived_at ?? null,
        aggregates,
        points,
      })
    }

    const signals = [...signalById.values()]
    return {
      generatedAt: new Date().toISOString(),
      dates: [...dates].sort(),
      channels: [...new Set(signals.map((s) => s.channel))],
      signals,
      sources: sourceRows.map((s) => ({
        id: s.id,
        provider: s.provider,
        label: s.label,
        status: s.status,
        last_sync_at: s.last_sync_at,
        last_sync_status: s.last_sync_status,
      })),
    }
  }

  /** tRPC query `signalsList` / MCP `signals-list` - the raw registry rows (no points). Archived
   *  signals only with `include_archived`. */
  @Get('definitions')
  @ApiOkResponse({ type: SignalDefinitionsDto })
  @Trpc({ output: signalDefinitionsOutput })
  @Mcp({ name: 'signals-list' })
  @Read()
  async list(@Query() query: SignalListQueryDto = {}): Promise<SignalDefinitionsDto> {
    const definitions = (await readSignalDefinitions({ includeArchived: flag(query?.include_archived) })) as SignalDefinition[] as SignalDefinitionDto[]
    return { generatedAt: new Date().toISOString(), definitions }
  }

  /**
   * tRPC query `signalsTrackers` / MCP `trackers-list` - everything a signal can be bound to: the
   * Box trackers this Box registers (with their parameters, enum options resolved) and the
   * trackers of every connected data source. Bind a Box tracker with signal-upsert tracker_key and
   * tracker_params (or goal-upsert tracker_key), a source tracker with data_source_id and tracker_key.
   */
  @Get('trackers')
  @ApiOkResponse({ type: TrackersDto })
  @Trpc({ output: trackersOutput })
  @Mcp({ name: 'trackers-list' })
  @Read()
  async trackers(): Promise<TrackersDto> {
    return { generatedAt: new Date().toISOString(), trackers: await trackerCatalogue() }
  }

  /**
   * tRPC query `signalsReferences` / MCP `signal-references` - where a signal is used: the goals,
   * milestones and trigger filters that name it, each with a label, how it uses the signal and a
   * link. Reported by the features that hold them; a Box without a feature simply lists fewer.
   */
  @Get('references')
  @ApiOkResponse({ type: SignalReferencesDto })
  @Trpc({ output: signalReferencesOutput })
  @Mcp({ name: 'signal-references' })
  @Read()
  async references(@Query() query: SignalReferencesQueryDto): Promise<SignalReferencesDto> {
    if (!(await readSignalDefinition(query.id))) throw inputError(new Error(`signal ${query.id} not found`))
    return { id: query.id, references: await signalReferences(query.id) }
  }

  /**
   * tRPC mutation `signalsUpsert` / MCP `signal-upsert` - create or partially update a signal
   * definition. A member's: whoever plans the work makes the signal that measures it (a milestone's
   * "New signal"). Re-keying, deleting, archiving and owners stay admin-only.
   */
  @Post('definition')
  @ApiOkResponse({ type: SignalDefinitionDto })
  @Trpc({ output: signalDefinitionOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-upsert' })
  async upsert(@Body() body: UpsertSignalDto, @Req() req: PrincipalRequest): Promise<SignalDefinitionDto> {
    body.actor ??= req.principal?.id
    const { unit, owner, data_source_id, tracker_key, tracker_params, formula, ...rest } = body
    // '' on tracker_key unbinds, and so does '' on data_source_id when no tracker_key comes with it.
    // data_source_id '' WITH a tracker_key is a Box tracker binding (no data source).
    const unbind = tracker_key === '' || (data_source_id === '' && tracker_key === undefined)
    let params: Record<string, string> | undefined
    if (tracker_params !== undefined) {
      try {
        const parsed: unknown = tracker_params.trim() === '' ? {} : JSON.parse(tracker_params)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        params = parsed as Record<string, string>
      } catch {
        throw new BadRequestException(`tracker_params must be a JSON object string, got: ${tracker_params}`)
      }
    }
    const binding = unbind
      ? { data_source_id: null, tracker_key: null }
      : {
          ...(data_source_id !== undefined ? { data_source_id: data_source_id === '' ? null : data_source_id } : {}),
          ...(tracker_key !== undefined ? { tracker_key } : {}),
          ...(params !== undefined ? { tracker_params: params } : {}),
        }
    // '' explicitly CLEARS unit/owner (the flattened scalar DTO has no other way to say null).
    try {
      return (await upsertSignalDefinition({
        ...rest,
        ...(unit !== undefined ? { unit: unit === '' ? null : unit } : {}),
        ...(owner !== undefined ? { owner: owner === '' ? null : owner } : {}),
        ...binding,
        // '' or null clears the formula (an ordinary signal again; its depends_on edges stay).
        ...(formula !== undefined ? { formula: formula === '' || formula === null ? null : formula } : {}),
      })) as SignalDefinition as SignalDefinitionDto
    } catch (e) {
      // The domain refuses unknown depends_on ids, cycles and out-of-enum values with
      // a message that says which - a 500 would strip exactly the part the caller needs to act on.
      throw inputError(e)
    }
  }

  /**
   * tRPC mutation `signalsRename` / MCP `signal-rename` - re-key a signal id, cascading to every
   * binding (initiatives, alert rules, depends_on edges, owners file, signals rows). Refused for
   * `source: 'derived'` signals - the deriver would re-create the old id on the next pull.
   */
  @Post('definition/rename')
  @ApiOkResponse({ type: SignalDefinitionDto })
  @Trpc({ output: signalDefinitionOutput, kind: 'mutation' })
  @Admin()
  @Mcp({ name: 'signal-rename' })
  async rename(@Body() body: RenameSignalDto, @Req() req: PrincipalRequest): Promise<SignalDefinitionDto> {
    try {
      return (await renameSignalDefinition(
        body.id,
        body.new_id,
        body.actor ?? req.principal?.id,
      )) as SignalDefinition as SignalDefinitionDto
    } catch (e) {
      throw inputError(e)
    }
  }

  /**
   * tRPC mutation `signalsDelete` / MCP `signal-delete` - remove a definition. Prunes depends_on
   * edges; reports (never touches) initiatives still binding the id; its points go with it.
   */
  @Post('definition/delete')
  @ApiOkResponse({ type: SignalDeleteReportDto })
  @Trpc({ kind: 'mutation' })
  @Admin()
  @Mcp({ name: 'signal-delete' })
  async delete(@Body() body: DeleteSignalDto, @Req() req: PrincipalRequest): Promise<SignalDeleteReportDto> {
    try {
      return await deleteSignalDefinition(body.id, body.actor ?? req.principal?.id)
    } catch (e) {
      throw inputError(e)
    }
  }

  /**
   * tRPC mutation `signalsArchive` / MCP `signal-archive` - archive a signal: it leaves
   * signals-list, the pickers and the Signals page (include_archived shows it again). Its
   * definition, points and every reference (goals, milestones, formulas) stay; reads of the signal
   * itself are unaffected. Configuration like signal-upsert, so admin-only.
   */
  @Post('definition/archive')
  @ApiOkResponse({ type: SignalDefinitionDto })
  @Trpc({ output: signalDefinitionOutput, kind: 'mutation' })
  @Admin()
  @Mcp({ name: 'signal-archive' })
  async archive(@Body() body: ArchiveSignalDto, @Req() req: PrincipalRequest): Promise<SignalDefinitionDto> {
    try {
      return (await setSignalArchived(body.id, true, body.actor ?? req.principal?.id)) as SignalDefinition as SignalDefinitionDto
    } catch (e) {
      throw inputError(e)
    }
  }

  /** tRPC mutation `signalsUnarchive` / MCP `signal-unarchive` - bring an archived signal back into the lists. */
  @Post('definition/unarchive')
  @ApiOkResponse({ type: SignalDefinitionDto })
  @Trpc({ output: signalDefinitionOutput, kind: 'mutation' })
  @Admin()
  @Mcp({ name: 'signal-unarchive' })
  async unarchive(@Body() body: ArchiveSignalDto, @Req() req: PrincipalRequest): Promise<SignalDefinitionDto> {
    try {
      return (await setSignalArchived(body.id, false, body.actor ?? req.principal?.id)) as SignalDefinition as SignalDefinitionDto
    } catch (e) {
      throw inputError(e)
    }
  }

  /** tRPC query `signalsOwners` / MCP `signal-owners` - the raw ownership mapping on disk. */
  @Get('owners')
  @ApiOkResponse({ type: OwnersDto })
  @Trpc({ output: ownersOutput })
  @Mcp({ name: 'signal-owners' })
  @Read()
  owners(): OwnersDto {
    return readSignalOwnersFile()
  }

  /**
   * tRPC mutation `signalsOwnersSave` / MCP `signal-owner-set` - set/unset one mapping in
   * the signal-owner settings (box.local.json). Applies at the next read - no restart needed. Configuration, so
   * admin-only. Since the registry became the first step of ownership resolution, a per-signal
   * mapping also lands on the signal definition when one exists (the file stays as the fallback
   * layer until it is retired at the end of Track B).
   */
  @Post('owners')
  @ApiOkResponse({ type: OwnersDto })
  @Trpc({ output: ownersOutput, kind: 'mutation' })
  @Admin()
  @Mcp({ name: 'signal-owner-set' })
  async ownersSave(@Body() body: SetOwnerDto, @Req() req: PrincipalRequest): Promise<OwnersDto> {
    if (body.owner !== undefined) await assertKnownUser(body.owner)
    const file = readSignalOwnersFile()
    if (body.scope === 'channel') {
      if (body.owner !== undefined) file.channels[body.key] = body.owner
      else delete file.channels[body.key]
    } else {
      if (body.owner !== undefined) file.signals[body.key] = body.owner
      else if (body.unowned) file.signals[body.key] = null
      else delete file.signals[body.key]
    }
    writeSignalOwnersFile(file)
    if (body.scope === 'signal' && (await readSignalDefinition(body.key))) {
      // owner set → definition carries it; unowned/removed → definition.owner null, so resolution
      // falls back to the file (where the explicit-null vs removed distinction still lives).
      await upsertSignalDefinition({
        id: body.key,
        owner: body.owner ?? null,
        actor: body.actor ?? req.principal?.id,
      })
    }
    return file
  }

  // --- points (phase B2) --------------------------------------------------------------------------

  /** One signal's manual points + shadow state, for the detail page's editor and agents. */
  private async pointsPayload(signalId: string): Promise<SignalPointsDto> {
    const def = await readSignalDefinition(signalId)
    if (!def) {
      throw new BadRequestException(`signal ${signalId} not found - points attach to a registered signal (signal-upsert first)`)
    }
    // The merged view (un-windowed) tells us which buckets a live value currently wins.
    const [records, merged] = await Promise.all([readSignalPointRecords(signalId), readSignalPoints(signalId)])
    const winners = new Map(merged.map((p) => [p.bucket, p]))
    return {
      signal_id: signalId,
      interval: def.interval,
      accumulation: def.accumulation,
      generatedAt: new Date().toISOString(),
      points: records
        .filter((r) => r.source === 'manual')
        .map((r) => {
          const bucket = floorSignalBucket(r.bucket, def.interval)
          const w = winners.get(bucket)
          return {
            bucket,
            value: r.value,
            note: r.note,
            shadowed_by: w && w.source !== 'manual' ? w.value : null,
            overrides_computed: w?.shadowed_computed ?? null,
            updated_at: r.updated_at,
            created_by: r.created_by,
            updated_by: r.updated_by,
          }
        }),
    }
  }

  /**
   * tRPC mutation `signalsSeries` / MCP `signal-series` - one signal's FULL MERGED history.
   *
   * This exists because `signal-points` is a manual-point EDITOR backend: it filters to
   * `source === 'manual'`, so it correctly returns `[]` for every purely-live signal - every signal
   * a pull or a deriver feeds. Read as "the tool is
   * broken" from the outside, and reasonably so, because the only method that returned a real series
   * was `GET /signals`, which carries `@Trpc()` and no `@Mcp()`. So over MCP there was no way to read
   * a signal's numbers at all, and every report that wanted one had to query the warehouse directly.
   *
   * Deliberately per-signal and windowable rather than exposing `GET /signals`: that returns every
   * definition with its full history, which on a Box with any real history is a report's payload,
   * not a tool call's.
   */
  @Post('series/list')
  @ApiOkResponse({ type: SignalSeriesDto })
  @Trpc({ output: signalSeriesOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-series' })
  @Read()
  async series(@Body() body: SignalSeriesListDto): Promise<SignalSeriesDto> {
    const def = await readSignalDefinition(body.signal_id)
    if (!def) {
      throw new BadRequestException(`signal ${body.signal_id} not found - signal-upsert first, or check signals-list for the id`)
    }
    const merged = await readSignalPoints(body.signal_id, body.from ? { from: body.from } : {})
    return {
      signal_id: def.id,
      label: def.label,
      channel: def.channel,
      interval: def.interval,
      accumulation: def.accumulation,
      unit: def.unit ?? null,
      generatedAt: new Date().toISOString(),
      count: merged.length,
      points: merged.map((p) => ({
        date: serializeBucket(p.bucket, def.interval),
        value: p.value,
        source: p.source,
        ...(p.computed ? { computed: true } : {}),
      })),
    }
  }

  /**
   * tRPC mutation `signalsPoints` / MCP `signal-points` - list a signal's MANUAL points with their
   * shadow state (a mutation-shaped read, the doc-read precedent: input-carrying reads reflect
   * their body this way; it mutates nothing).
   *
   * THIS IS THE EDITOR BACKEND, NOT THE SERIES READ. It returns `[]` for a signal whose buckets are
   * all `live`, which is correct and is not a fault - a pulled signal has live points and zero
   * manual ones. For a signal's actual numbers use `signal-series` above.
   */
  @Post('points/list')
  @ApiOkResponse({ type: SignalPointsDto })
  @Trpc({ output: signalPointsOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-points' })
  @Read()
  async points(@Body() body: SignalPointsListDto): Promise<SignalPointsDto> {
    return this.pointsPayload(body.signal_id)
  }

  /**
   * tRPC mutation `signalsPointSet` / MCP `signal-point-set` - upsert ONE manual point at
   * floor(at, interval). Operational data entry: any authenticated user; audit carries the actor.
   */
  @Post('point')
  @ApiOkResponse({ type: SignalPointsDto })
  @Trpc({ output: signalPointsOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-point-set' })
  async pointSet(@Body() body: SetSignalPointDto, @Req() req: PrincipalRequest): Promise<SignalPointsDto> {
    try {
      await setSignalPoint({
        signal_id: body.signal_id,
        at: body.at,
        value: body.value,
        // '' explicitly clears the note (the scalar-DTO convention); omitting keeps the stored one.
        ...(body.note !== undefined ? { note: body.note === '' ? null : body.note } : {}),
        actor: body.actor ?? req.principal?.id,
      })
      return await this.pointsPayload(body.signal_id)
    } catch (e) {
      throw inputError(e)
    }
  }

  /** tRPC mutation `signalsPointDelete` / MCP `signal-point-delete` - remove one manual point. */
  @Post('point/delete')
  @ApiOkResponse({ type: SignalPointsDto })
  @Trpc({ output: signalPointsOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-point-delete' })
  async pointDelete(@Body() body: DeleteSignalPointDto): Promise<SignalPointsDto> {
    try {
      await deleteSignalPoint(body.signal_id, body.at)
      return await this.pointsPayload(body.signal_id)
    } catch (e) {
      throw inputError(e)
    }
  }

  /**
   * tRPC mutation `signalsPointsSet` / MCP `signal-points-set` - the bulk manual path: twelve
   * monthly Cash Balance points in one call. `points` is a JSON array string (the task-upsert
   * `metadata` precedent - @Mcp inputs stay scalar). All-or-nothing: every entry is validated
   * before anything writes.
   */
  @Post('points')
  @ApiOkResponse({ type: SignalPointsDto })
  @Trpc({ output: signalPointsOutput, kind: 'mutation' })
  @Mcp({ name: 'signal-points-set' })
  async pointsSet(@Body() body: SetSignalPointsDto, @Req() req: PrincipalRequest): Promise<SignalPointsDto> {
    let parsed: unknown
    try {
      parsed = JSON.parse(body.points)
    } catch {
      throw new BadRequestException(`points must be a JSON array string, e.g. [{"at":"2025-09-01","value":118000}]`)
    }
    if (!Array.isArray(parsed)) throw new BadRequestException('points must be a JSON ARRAY of {at, value, note?}')
    const entries = parsed.map((e, i) => {
      const p = e as { at?: unknown; value?: unknown; note?: unknown }
      if (typeof p?.at !== 'string' || typeof p?.value !== 'number' || (p.note !== undefined && typeof p.note !== 'string')) {
        throw new BadRequestException(`points[${i}] must be {at: string, value: number, note?: string}`)
      }
      return { at: p.at, value: p.value, ...(p.note !== undefined ? { note: p.note } : {}) }
    })
    try {
      await setSignalPoints(body.signal_id, entries, body.actor ?? req.principal?.id)
      return await this.pointsPayload(body.signal_id)
    } catch (e) {
      throw inputError(e)
    }
  }

  /**
   * tRPC mutation `signalsEvent` / MCP `signal-event` - record one occurrence of an increment
   * signal. Idempotent via dedup_key (the same occurrence fired twice counts 1); the signal's
   * live buckets re-derive from its events on every fresh record.
   */
  @Post('event')
  @ApiOkResponse({ type: SignalEventResultDto })
  @Trpc({ kind: 'mutation' })
  @Mcp({ name: 'signal-event' })
  async event(@Body() body: SignalEventDto, @Req() req: PrincipalRequest): Promise<SignalEventResultDto> {
    try {
      return await recordSignalIncrement({
        signal_id: body.signal_id,
        at: body.at,
        dedup_key: body.dedup_key,
        actor: body.actor ?? req.principal?.id,
      })
    } catch (e) {
      throw inputError(e)
    }
  }
}
