import * as React from 'react'

/** The member view flag: true under an active `SettingsReadOnly`. Write pieces (`Field`, a settings
 *  control row, save and create slots) read it and leave themselves out; reader controls ignore it.
 *  It lives outside `settings/` because generic pieces such as `Field` read it too. */
export const SettingsReadOnlyContext = React.createContext(false)
