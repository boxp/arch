import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob, file } from 'astro/loaders';

const isoDate = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'YYYY-MM or YYYY-MM-DD');
// 経歴の期間は根拠の粒度に合わせて年だけでもよい（月まで裏付けが無い場合に推測で埋めない）。
const period = z.string().regex(/^\d{4}(-\d{2})?$/, 'YYYY or YYYY-MM');

// 経歴: 1 職務 1 Markdown。本人の公開記事や LinkedIn など、公開されている一次情報で裏付けのある要約のみ転記する。
const experience = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/experience' }),
  schema: z.object({
    company: z.string(),
    title: z.string(),
    start: period,
    // 'by': 在籍開始時期は不明で、start 時点で在籍していたことだけ確認できている（「2018 以前」と表示）。
    startQualifier: z.enum(['exact', 'by']).default('exact'),
    end: period.nullable().default(null),
    location: z.string().optional(),
    summary: z.string(),
    // 内容を公開情報と突き合わせた日と、その公開情報の URL。
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sources: z.array(z.url()).min(1),
    linkedinSyncedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
