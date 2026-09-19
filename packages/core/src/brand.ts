// Read the brand when used. Vite embeds the same section at build time.
import { type BoxBrand } from './box-json.js'
import { boxJson } from './box-config.js'
export type { BoxBrand }
export const boxBrand = (): BoxBrand => boxJson().brand
