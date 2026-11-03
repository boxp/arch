import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob, file } from 'astro/loaders';

const isoDate = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD');

// 経歴: 1 社 1 Markdown。LinkedIn プロフィールを正本とし、要約のみ転記する。
const experience = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/experience' }),
  schema: z.object({
    company: z.string(),
    title: z.string(),
    start: isoDate,
    end: isoDate.nullable().default(null),
    location: z.string().optional(),
    summary: z.string(),
    linkedinSyncedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

const skills = defineCollection({
  loader: file('./src/content/skills.json'),
  schema: z.object({
    id: z.string(),
    category: z.string(),
    order: z.number(),
    items: z.array(
      z.object({
        name: z.string(),
        evidence: z.array(z.string()).default([]),
      }),
    ),
  }),
});

const projects = defineCollection({
  loader: file('./src/content/projects.json'),
  schema: z.object({
    id: z.string(),
    repo: z.string(),
    name: z.string(),
    description: z.string(),
    language: z.string().optional(),
    tags: z.array(z.string()).default([]),
    lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    stars: z.number().optional(),
    archived: z.boolean().default(false),
  }),
});

const articles = defineCollection({
  loader: file('./src/content/articles.json'),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    url: z.url(),
    publishedAt: isoDate,
    publisher: z.string(),
    summary: z.string().optional(),
  }),
});

const talks = defineCollection({
  loader: file('./src/content/talks.json'),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    url: z.url(),
    date: isoDate,
    event: z.string().optional(),
    category: z.enum(['engineering', 'hobby']).default('engineering'),
  }),
});

export const collections = { experience, skills, projects, articles, talks };
