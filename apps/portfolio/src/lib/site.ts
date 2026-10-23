import { SITE_ENV } from 'astro:env/server';

/** ビルド時の環境。stage では検索エンジン向けに noindex を付け、画面上に stage バナーを出す。 */
export const siteEnv = SITE_ENV;
export const isStage = SITE_ENV === 'stage';
