// Moved to the component library (@silkweave/box-ui/lib): the shell components that persist a
// setting need it, and a second copy would mean two caches disagreeing about the same key. This is
// the app's alias onto that one instance.
export { readStored, usePersistedState, writeStored } from '@silkweave/box-ui/lib'
