/** The weather layers the pane draws; each toggles on its own. */
export type IsobarLayers = { code: boolean; impact: boolean; risk: boolean; history: boolean }

declare module 'claude-code' {
  interface PluginState {
    isobar: {
      /** Bumped whenever the facts, the map or the weather change; the pane redraws on it. */
      tick: number
      layers: IsobarLayers
      /** Whether the pane has opened this session, so a reload never reopens one the person closed. */
      opened: boolean
    }
  }
}
