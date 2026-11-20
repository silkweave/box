import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button.tsx'
import { SettingsFact, SettingsFacts } from './SettingsFacts.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { SettingsNotice } from './states.tsx'
import { PaneFrame, SERVER } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsFacts',
  component: SettingsFacts,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsFacts>

export default meta
type Story = StoryObj

const SIGN_IN_URL = 'https://box.example.com/auth/saml'

/** Two columns of facts on the canvas, ids in mono with a copy button. */
export const Default: Story = {
  render: () => (
    <PaneFrame title='Single sign-on' className='h-auto'>
      <>
        <SettingsFacts>
          <SettingsFact label='Sign-in URL' mono copy={SIGN_IN_URL}>{SIGN_IN_URL}</SettingsFact>
          <SettingsFact label='Issuer' mono copy='box-example'>box-example</SettingsFact>
          <SettingsFact label='Certificate'>Expires 2027-11-17</SettingsFact>
          <SettingsFact label='Allowed email domains'><span className='text-muted-foreground'>Not set</span></SettingsFact>
        </SettingsFacts>
      </>
    </PaneFrame>
  ),
}

/** Variants: one and three columns, a fact spanning the row. */
export const Variants: Story = {
  render: () => (
    <PaneFrame title='Variants' className='h-auto'>
      <>
        <SettingsFacts columns={3}>
          <SettingsFact label='Sent'>1,204</SettingsFact>
          <SettingsFact label='Delivered'>1,198</SettingsFact>
          <SettingsFact label='Opt-outs'>3</SettingsFact>
          <SettingsFact label='Fingerprint (SHA-256)' mono span='full'>4F:2A:91:C0:7B:EE:13:5D:8A:66:0F:D2:9C:41:B7:3E:A5:1C:72:90:E8:5B:2D:44:CC:19:F3:06:7A:B1:8E:52</SettingsFact>
        </SettingsFacts>
        <SettingsFacts columns={1}>
          <SettingsFact label='Address' mono copy={SERVER.url} hint='Set in box.json under mcp.servers.'>{SERVER.url}</SettingsFact>
        </SettingsFacts>
      </>
    </PaneFrame>
  ),
}

/** States: missing values are the caller's muted "Not set"; a long value wraps. */
export const States: Story = {
  render: () => (
    <PaneFrame title='States' className='h-auto'>
      <>
        <SettingsFacts>
          <SettingsFact label='Metadata'><span className='text-muted-foreground'>Not set</span></SettingsFact>
          <SettingsFact label='Callback' mono copy='https://box.example.com/api/hooks/stripe/7f3a91c2-48d1-4c55-9a0e-2b4c8d6f1e3a'>https://box.example.com/api/hooks/stripe/7f3a91c2-48d1-4c55-9a0e-2b4c8d6f1e3a</SettingsFact>
        </SettingsFacts>
      </>
    </PaneFrame>
  ),
}

/** InContext: an Overview section, a notice first, facts inside a group with its operational act. */
export const InContext: Story = {
  render: () => (
    <PaneFrame title='Webhooks'>
      <>
        <SettingsNotice tone='warning' title='The relay is offline'>Deliveries wait until it reconnects. Reconnect from the Relay group.</SettingsNotice>
        <SettingsGroup title='Relay' aside={<Button size='xs' variant='outline'>Reconnect</Button>}>
          <SettingsFacts>
            <SettingsFact label='Address' mono copy='https://relay.example.com/box'>https://relay.example.com/box</SettingsFact>
            <SettingsFact label='Last seen'>2026-11-17 09:12</SettingsFact>
          </SettingsFacts>
        </SettingsGroup>
      </>
    </PaneFrame>
  ),
}
