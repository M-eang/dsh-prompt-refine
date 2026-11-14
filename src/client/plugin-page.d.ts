/**
 * Slot contract of the Plugins-panel row configuration page.
 *
 * `plugins.row.config` is declared by `@deepseek-ai/dsh-client-ui-plugin-manager`,
 * which owns the Plugins panel. That package ships its browser bundle without
 * type declarations, and this repository's dev dependency family predates the
 * slot entirely, so the key would be invisible to TypeScript — `register` would
 * reject the name before the runtime ever saw it. Merging the entry here keeps
 * the call site checked: the key is a keyed root slot whose registration key is
 * a free string, because the panel addresses rows by
 * `<bundle package name>#<row id>` — a name it cannot know in advance.
 *
 * The panel renders that entry with owner props: `view` (`page` for the form,
 * `summary` for the one-line description it shows as the row's collapsed
 * detail) and, on the page view, the `form` seat for this row's settings
 * namespace. Both are declared here so the component's props and the
 * registration agree.
 *
 * `export {}` makes this file a module; module augmentation only applies from a
 * module, and this one declares nothing else.
 */

import type { SettingsFormSeat } from './SettingsCard'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The configure page a loader row contributes to the Plugins panel. */
    'plugins.row.config': {
      kind: 'keyed'
      scope: 'root'
      /** Registration key is `<bundle package name>#<row id>`; props are asked per render. */
      keyProps: Record<string, { view?: 'page' | 'summary'; form?: SettingsFormSeat }>
    }
  }
}

export {}
