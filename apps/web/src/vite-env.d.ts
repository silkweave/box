/// <reference types="vite/client" />

// `virtual:box-brand` is emitted by apps/web/branding.ts at build time from `box.json`, so the
// browser bundle carries the brand without reading a file or fetching it. Its shape is core's
// `BoxBrand`; the import is type-only here, so nothing of packages/core reaches the bundle.
declare module 'virtual:box-brand' {
  const brand: import('@silkweave/box-core/box-json').BoxBrand
  export default brand
}
