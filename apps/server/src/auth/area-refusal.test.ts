// An area refusal thrown inside a handler by a core accessor is a refusal on every transport (403 on REST, FORBIDDEN on tRPC, an MCP tool error with code area_access): the
// silkweave adapters (tRPC, MCP) through withCallContext, REST through AreaAccessFilter.

import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { SilkweaveError, type Action } from '@silkweave/core'
import { AreaAccessError } from '@silkweave/box-core'
import { withCallContext } from './call-context.js'
import { AreaAccessFilter } from './area-access.filter.js'

const refusing = (run: Action['run']): Action => ({ name: 'refuse', description: '', input: {} as never, run }) as Action

describe('area refusals', () => {
  it('leave a silkweave action as a 403 SilkweaveError; other errors pass unchanged', async () => {
    const err = await (withCallContext(refusing(async () => { throw new AreaAccessError('crm', 'write') })).run as (i: unknown, c: unknown) => Promise<unknown>)({}, {}).catch((e) => e)
    expect(err).toBeInstanceOf(SilkweaveError)
    expect(err).toMatchObject({ statusCode: 403, code: 'area_access', message: 'no write access to crm' })
    const other = new Error('boom')
    await expect((withCallContext(refusing(async () => { throw other })).run as (i: unknown, c: unknown) => Promise<unknown>)({}, {})).rejects.toBe(other)
  })

  it('give a guard refusal its own code, and leave other http errors alone', async () => {
    const run = (e: unknown) => (withCallContext(refusing(async () => { throw e })).run as (i: unknown, c: unknown) => Promise<unknown>)({}, {}).catch((x) => x)
    expect(await run(new SilkweaveError('admin only', 'http_error', 403))).toMatchObject({ code: 'forbidden', statusCode: 403, message: 'admin only' })
    expect(await run(new SilkweaveError('sign in required', 'http_error', 401))).toMatchObject({ code: 'unauthorized', statusCode: 401 })
    expect(await run(new ForbiddenException('not yours'))).toMatchObject({ code: 'forbidden', statusCode: 403, message: 'not yours' })
    expect(await run(new ForbiddenException({ error: 'area_access', message: 'no read access to crm' }))).toMatchObject({ code: 'area_access', statusCode: 403 })
    expect(await run(new UnauthorizedException('sign in required'))).toMatchObject({ code: 'unauthorized', statusCode: 401 })
    expect(await run(new NotFoundException('gone'))).toBeInstanceOf(NotFoundException)
    expect(await run(new SilkweaveError('gone', 'http_error', 404))).toMatchObject({ code: 'http_error', statusCode: 404 })
  })

  it('leave a streaming action as a 403 SilkweaveError', async () => {
    const action = withCallContext(refusing(async function* () { yield 1; throw new AreaAccessError('ops', 'read') } as never))
    const seen: unknown[] = []
    const err = await (async () => { for await (const c of (action.run as (i: unknown, c: unknown) => AsyncIterable<unknown>)({}, {})) seen.push(c) })().catch((e) => e)
    expect(seen).toEqual([1])
    expect(err).toMatchObject({ statusCode: 403, code: 'area_access' })
  })

  it('answer a REST call 403 with the guard refusal body', () => {
    let status = 0
    let body: unknown
    const res = { status: (s: number) => ((status = s), { json: (b: unknown) => void (body = b) }) }
    new AreaAccessFilter().catch(new AreaAccessError('crm', 'write'), { switchToHttp: () => ({ getResponse: () => res }) } as never)
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'area_access', area: 'crm', needed: 'write', message: 'no write access to crm' })
  })
})
