import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-links', '@chromatic-com/storybook'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    // The app's PWA/service-worker plugin has no assets to precache in a
    // Storybook build and fails it — Storybook doesn't need a service worker.
    config.plugins = (config.plugins ?? [])
      .flat()
      .filter((p) => !(p && typeof p === 'object' && 'name' in p && String(p.name).includes('pwa')))
    return config
  },
}

export default config
