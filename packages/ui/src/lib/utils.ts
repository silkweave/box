import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The design system defines its own font-size utilities (text-label, text-body, text-heading-1, …) in
// styles/globals.css `@theme`. tailwind-merge doesn't know these names are font sizes, so out of the
// box it lumps e.g. `text-label` and `text-muted-foreground` into one `text-*` bucket and drops the
// first - which silently strips the size, rendering text at the inherited body size. Register the
// scale so a size and a color coexist in the same cn() call. Keep in sync with --text-* in globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-xl',
            'display-lg',
            'display-md',
            'display-sm',
            'heading-1',
            'heading-2',
            'heading-3',
            'body',
            'body-sm',
            'label',
            'code',
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
