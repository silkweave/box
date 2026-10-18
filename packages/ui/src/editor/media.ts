/**
 * The media rule shared by the editor and anything that renders its markdown. Images and videos are
 * both written as markdown images, `![alt](url)`; a URL whose path ends in a video extension is a
 * video. Pure on purpose: exported from `@silkweave/box-ui/editor` without pulling in TipTap.
 */
const VIDEO_PATH = /\.(mp4|webm|mov|m4v|ogv)$/i

/** Whether a media URL (absolute, root-relative or relative; query and fragment ignored) is a video. */
export function isVideoUrl(url: string): boolean {
  return VIDEO_PATH.test(url.trim().split(/[?#]/, 1)[0] ?? '')
}
