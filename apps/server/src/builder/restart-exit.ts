/** Exit code a running Box server uses to ask its supervisor for a fresh process (`service-restart`).
 * Any other unrequested exit is a crash and stays `failed` until `box app restart`. */
export const APP_RESTART_EXIT_CODE = 86
