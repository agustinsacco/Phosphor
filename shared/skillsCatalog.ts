/**
 * Curated skill libraries for the Discover tab.
 *
 * Same contract as the extensions catalogue (`catalogue.ts`): a static list
 * of sources we have actually read, pinned by commit SHA, so Add never
 * fetches anything unreviewed. Descriptions are harvested verbatim from each
 * skill's SKILL.md frontmatter at the pinned SHA (2026-09-04). Updating a
 * library = reviewing upstream, then bumping its `sha` here; installed-skill
 * rows compare their provenance sidecar against this pin to offer updates.
 */

export interface SkillCatalogSkill {
  name: string
  description: string
  /** Reviewed bundle manifest, avoiding unrelated files in repository zipballs. */
  files?: string[]
}

export interface SkillCatalogLibrary {
  id: string
  label: string
  /** GitHub `owner/repo`. */
  repo: string
  /** Pinned commit — the only ref installs ever fetch. */
  sha: string
  url: string
  blurb: string
  /** Path inside the repo holding `<skill>/SKILL.md` dirs. */
  subpath: string
  skills: SkillCatalogSkill[]
}

export const SKILL_CATALOG: SkillCatalogLibrary[] = [
  {
    id: 'anthropic-skills',
    label: 'Anthropic — official skills',
    repo: 'anthropics/skills',
    sha: '41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f',
    url: 'https://github.com/anthropics/skills',
    blurb: "Anthropic's public Agent Skills repository. Each skill ships its own LICENSE.txt.",
    subpath: 'skills',
    skills: [
      {
        name: 'canvas-design',
        description:
          "Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece. Create original visual designs, never copying existing artists' work to avoid copyright violations.",
      },
      {
        name: 'brand-guidelines',
        description:
          "Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatting, or company design standards apply.",
      },
      {
        name: 'frontend-design',
        description:
          "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.",
      },
      {
        name: 'theme-factory',
        description:
          'Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reportings, HTML landing pages, etc. There are 10 pre-set themes with colors/fonts that you can apply to any artifact that has been creating, or can generate a new theme on-the-fly.',
      },
      {
        name: 'web-artifacts-builder',
        description:
          'Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components - not for simple single-file HTML/JSX artifacts.',
      },
      {
        name: 'algorithmic-art',
        description:
          "Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to...",
      },
      {
        name: 'doc-coauthoring',
        description:
          'Guide users through a structured workflow for co-authoring documentation. Use when user wants to write documentation, proposals, technical specs, decision docs, or similar structured content. This workflow helps users efficiently transfer context, refine content through iteration, and verify the...',
      },
      {
        name: 'docx',
        description:
          "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files) or Word templates (.dotx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', '.dotx', or requests to produce professional documents with formatting like tables of co...",
      },
      {
        name: 'pdf',
        description:
          'Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs,...',
      },
      {
        name: 'pptx',
        description:
          'Use this skill any time a .pptx or .potx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx or .potx file (even if the extracted content will be used elsewhere, like in an...',
      },
      {
        name: 'xlsx',
        description:
          'Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .xltx, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new...',
      },
      {
        name: 'mcp-builder',
        description:
          'Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).',
      },
      {
        name: 'skill-creator',
        description:
          "Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for bette...",
      },
      {
        name: 'webapp-testing',
        description:
          'Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.',
      },
      {
        name: 'slack-gif-creator',
        description:
          'Knowledge and utilities for creating animated GIFs optimized for Slack. Provides constraints, validation tools, and animation concepts. Use when users request animated GIFs for Slack like "make me a GIF of X doing Y for Slack.',
      },
      {
        name: 'internal-comms',
        description:
          'A set of resources to help me write all kinds of internal communications, using the formats that my company likes to use. Claude should use this skill whenever asked to write some sort of internal communications (status reports, leadership updates, 3P updates, company newsletters, FAQs, incident...',
      },
      {
        name: 'claude-api',
        description:
          'Reference for the Claude API / Anthropic SDK — model ids, pricing, params, streaming, tool use, MCP, agents, caching, token counting, model migration. TRIGGER — read BEFORE opening the target file; don\'t skip because it "looks like a one-liner" — whenever: the prompt names Claude/Anthropic in any...',
      },
      {
        name: 'academy-guide',
        description:
          'Stop and check this skill before finishing any reply to a question about how to use Claude or a Claude product — it recommends matching courses, tutorials, and use cases from Claude Academy (academy.claude.com), Anthropic\'s learning hub. Trigger on: "how do I", "how can I", "getting started with"...',
      },
      {
        name: 'discernment-nudge',
        description:
          'After you give a substantive answer or draft that the user may act on — advice or recommendations, drafted artifacts such as goals, plans, pitches, proposals, or emails, estimates or projections, analysis or interpretation of data, factual claims they may rely on, or a multi-step argument — invok...',
      },
    ],
  },
  {
    id: 'superpowers',
    label: 'obra/superpowers — agentic development',
    repo: 'obra/superpowers',
    sha: 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797',
    url: 'https://github.com/obra/superpowers',
    blurb:
      'The reference agentic-development framework: battle-tested process skills for TDD, debugging and planning.',
    subpath: 'skills',
    skills: [
      {
        name: 'test-driven-development',
        description:
          'Use when implementing any feature or bugfix, before writing implementation code',
      },
      {
        name: 'systematic-debugging',
        description:
          'Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes',
      },
      {
        name: 'brainstorming',
        description:
          'You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.',
      },
      {
        name: 'writing-plans',
        description:
          'Use when you have a spec or requirements for a multi-step task, before touching code',
      },
      {
        name: 'executing-plans',
        description:
          'Use when you have a written implementation plan to execute in a separate session with review checkpoints',
      },
      {
        name: 'verification-before-completion',
        description:
          'Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always',
      },
      {
        name: 'requesting-code-review',
        description:
          'Use when completing tasks, implementing major features, or before merging to verify work meets requirements',
      },
      {
        name: 'receiving-code-review',
        description:
          'Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation',
      },
      {
        name: 'dispatching-parallel-agents',
        description:
          'Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies',
      },
      {
        name: 'subagent-driven-development',
        description:
          'Use when executing implementation plans with independent tasks in the current session',
      },
      {
        name: 'using-git-worktrees',
        description:
          'Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback',
      },
      {
        name: 'finishing-a-development-branch',
        description:
          'Use when implementation is complete, all tests pass, and you need to decide how to integrate the work',
      },
      {
        name: 'writing-skills',
        description:
          'Use when creating new skills, editing existing skills, or verifying skills work before deployment',
      },
    ],
  },
  {
    id: 'addy-agent-skills',
    label: 'addyosmani/agent-skills — engineering practice',
    repo: 'addyosmani/agent-skills',
    sha: '1c760d643497e9da289300e5eb2f5aca861503f7',
    url: 'https://github.com/addyosmani/agent-skills',
    blurb:
      'Curated engineering-practice skills, also distributed as a Claude Code plugin marketplace.',
    subpath: 'skills',
    skills: [
      {
        name: 'code-review-and-quality',
        description:
          'Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.',
      },
      {
        name: 'code-simplification',
        description:
          'Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity.',
      },
      {
        name: 'debugging-and-error-recovery',
        description:
          "Guides systematic root-cause debugging. Use when tests fail, builds break, behavior doesn't match expectations, or you encounter any unexpected error. Use when you need a systematic approach to finding and fixing the root cause rather than guessing.",
      },
      {
        name: 'performance-optimization',
        description:
          'Optimizes application performance across frontend, backend, queries, and databases. Use when performance requirements exist, when you suspect performance regressions, when Core Web Vitals or load times need improvement, when N+1 query patterns need fixing, or when profiling reveals bottlenecks.',
      },
      {
        name: 'planning-and-task-breakdown',
        description:
          'Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.',
      },
      {
        name: 'security-and-hardening',
        description:
          'Hardens code against vulnerabilities. Use when handling user input, authentication, data storage, or external integrations. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services. Use when auditing dependencies for known vulnerabil...',
      },
      {
        name: 'spec-driven-development',
        description:
          'Creates specs before coding. Use when starting a new project, feature, or significant change and no specification exists yet. Use when requirements are unclear, ambiguous, or only exist as a vague idea. Use when a single requirement spans several independently testable capabilities and needs deco...',
      },
      {
        name: 'test-driven-development',
        description:
          "Drives development with tests. Use when implementing any logic, fixing any bug, or changing any behavior. Use when you need to prove that code works, when a bug report arrives, or when you're about to modify existing functionality.",
      },
      {
        name: 'context-engineering',
        description:
          'Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project.',
      },
      {
        name: 'incremental-implementation',
        description:
          "Delivers changes incrementally. Use when implementing any feature or change that touches more than one file. Use when you're about to write a large amount of code at once, or when a task feels too big to land in one step.",
      },
    ],
  },
]

export function catalogLibrary(id: string): SkillCatalogLibrary | undefined {
  return SKILL_CATALOG.find((library) => library.id === id)
}
