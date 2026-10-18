import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'
import { isVideoUrl } from './media.ts'

/**
 * Images and videos in the document. One node, the official Image extension, so markdown stays
 * `![alt](src)` both ways (its parseMarkdown/renderMarkdown). What differs is only how a node draws:
 * a `src` that `isVideoUrl` calls a video renders as `<video controls>`, anything else as `<img>`.
 * A block, as TipTap's markdown expects: a paragraph holding only an image parses to the bare node.
 */
export const Media = Image.extend({
  parseHTML() {
    return [{ tag: 'img[src]:not([src^="data:"])' }, { tag: 'video[src]', getAttrs: (el) => ({ src: el.getAttribute('src'), title: el.getAttribute('title'), alt: el.getAttribute('aria-label') }) }]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    if (typeof attrs.src === 'string' && isVideoUrl(attrs.src)) {
      const { alt, ...rest } = attrs
      return ['video', { ...rest, controls: 'true', preload: 'metadata', ...(alt ? { 'aria-label': alt } : {}) }]
    }
    return ['img', attrs]
  },

  addNodeView() {
    return ({ node }) => {
      const video = isVideoUrl(String(node.attrs.src ?? ''))
      const el = document.createElement(video ? 'video' : 'img')
      const apply = (attrs: Record<string, unknown>) => {
        const src = typeof attrs.src === 'string' ? attrs.src : ''
        if (el.getAttribute('src') !== src) el.setAttribute('src', src)
        const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
        el.setAttribute(video ? 'aria-label' : 'alt', alt)
        if (typeof attrs.title === 'string' && attrs.title) el.setAttribute('title', attrs.title)
        else el.removeAttribute('title')
      }
      if (el instanceof HTMLVideoElement) {
        el.controls = true
        el.preload = 'metadata'
      }
      apply(node.attrs)
      return {
        dom: el,
        update: (updated) => {
          // A different node, or a src that switches between image and video, needs a fresh element.
          if (updated.type !== node.type || isVideoUrl(String(updated.attrs.src ?? '')) !== video) return false
          apply(updated.attrs)
          return true
        },
        // Let the video's own controls take clicks instead of ProseMirror selecting the node.
        stopEvent: (event) => video && event.type !== 'dragstart' && event.target === el,
        ignoreMutation: () => true,
      }
    }
  },
})
