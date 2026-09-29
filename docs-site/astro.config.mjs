import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';

// Built into the gateway's own public directory, so the docs ship with the site rather than as a
// second deployment. Search is Pagefind, which is indexed at build time and served as static files —
// no account, no external service, and it keeps working if the docs are ever put behind the gate.
export default defineConfig({
  site: 'https://staves.io',
  base: '/docs',
  outDir: '../public/docs',
  trailingSlash: 'ignore',
  // Preserve the existing Markdown plugins and inline whitespace on Astro 7.
  markdown: { processor: unified() },
  compressHTML: true,
  integrations: [
    starlight({
      title: 'Staves',
      description: 'Describe how work happens — who does what, what passes between them, where it stalls.',
      social: [{ icon: 'external', label: 'Open Staves', href: 'https://staves.io/workspace' }],
      editLink: undefined,
      lastUpdated: true,
      pagination: true,
      customCss: ['./src/styles/staves.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Your first session', slug: 'first-session' },
            { label: 'What Staves is for', slug: 'start' },
            { label: 'Use Staves without an account', slug: 'open-source' },
            { label: 'Start with one human outcome', slug: 'first-board' },
          ],
        },
        {
          label: 'Connect your agent',
          items: [
            { label: 'Bring in a coding agent', slug: 'connect' },
            { label: 'The skill in your project', slug: 'skill' },
            { label: 'Langfuse execution evidence', slug: 'langfuse' },
            { label: 'Per client', slug: 'clients' },
            { label: 'When it does not work', slug: 'troubleshooting' },
          ],
        },
        {
          label: 'How to',
          items: [
            { label: 'Design through conversation', slug: 'how-to/conversations' },
            { label: 'Describe a repository', slug: 'how-to/describe-a-repo' },
            { label: 'Pick a board back up', slug: 'how-to/resume' },
            { label: 'Review a workflow', slug: 'how-to/review' },
            { label: 'Ask and answer questions', slug: 'how-to/questions' },
            { label: 'Try a change safely', slug: 'how-to/scenarios' },
            { label: 'Investigate a design change', slug: 'how-to/impact-investigation' },
            { label: 'Build a shared vocabulary', slug: 'how-to/domain-vocabulary' },
            { label: 'Connect design to Git', slug: 'how-to/design-and-development' },
            { label: 'Hand work off', slug: 'how-to/handoff' },
            { label: 'Get more from the skill', slug: 'how-to/working-with-the-skill' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'What everything on a board means', slug: 'reference/reading-a-board' },
            { label: 'Every tool, and when to use it', slug: 'reference/tools' },
            { label: 'The Staves format', slug: 'reference/format' },
          ],
        },
        {
          label: 'Working on a board',
          items: [
            { label: 'Read the workflow', slug: 'read-the-workflow' },
            { label: 'Explore and change the canvas', slug: 'canvas' },
            { label: 'Turn questions into better work', slug: 'questions' },
            { label: 'Share and hand off', slug: 'handoff' },
          ],
        },
        {
          label: 'Your account',
          items: [
            { label: 'Account, keys and connections', slug: 'account' },
            { label: 'Your data in the beta', slug: 'beta-data' },
            { label: 'Run Staves from source', slug: 'from-source' },
          ],
        },
      ],
    }),
  ],
});
