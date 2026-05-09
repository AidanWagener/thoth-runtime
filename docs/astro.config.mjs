import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://docs.thoth-runtime.dev',
  integrations: [
    starlight({
      title: 'Thoth',
      description: 'The lifelong-learning agent runtime',
      logo: {
        src: './public/logo.svg',
        alt: 'Thoth',
      },
      social: {
        github: 'https://github.com/thoth-runtime/thoth',
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Quickstart', link: '/quickstart/' },
            { label: 'Slack setup', link: '/transports/slack/' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: '5-layer memory', link: '/concepts/memory/' },
            { label: 'Persona stack', link: '/concepts/persona-stack/' },
            { label: 'Reflection at session-end', link: '/concepts/reflection/' },
            { label: 'Skills', link: '/concepts/skills/' },
            { label: 'Reactions as training signals', link: '/concepts/reactions/' },
            { label: 'Ambient agents', link: '/concepts/ambient/' },
            { label: 'Multi-agent party', link: '/concepts/party/' },
          ],
        },
        {
          label: 'Transports',
          items: [
            { label: 'Slack', link: '/transports/slack/' },
            { label: 'Discord', link: '/transports/discord/' },
            { label: 'Webhook', link: '/transports/webhook/' },
          ],
        },
        {
          label: 'Specs (public roadmap)',
          autogenerate: { directory: 'specs' },
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', link: '/reference/cli/' },
            { label: 'Configuration', link: '/reference/config/' },
            { label: 'Environment variables', link: '/reference/env/' },
          ],
        },
        {
          label: 'Architecture decision records',
          autogenerate: { directory: 'adr' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
