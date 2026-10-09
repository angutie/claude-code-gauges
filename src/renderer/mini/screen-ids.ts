/**
 * Mini carousel screen ids in carousel order. Kept in a dependency-free module so pure code
 * (e.g. help content) can import it without pulling in MiniApp and creating an import cycle.
 */
export const MINI_SCREEN_IDS = ['gauges', 'sessions', 'settings', 'playground'] as const

export type MiniScreenId = (typeof MINI_SCREEN_IDS)[number]
