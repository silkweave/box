// `cn` lives in the component library (@silkweave/box-ui/lib) because its tailwind-merge config is
// tied to the design-token font-size scale that ships with it. This file is the app's `@/lib/utils`
// alias onto that one instance, so the ~90 call sites here did not have to move with it.
export { cn } from '@silkweave/box-ui/lib'
