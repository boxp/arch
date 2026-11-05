import { isStage } from './site';

/** 公開可否の区分。architecture の匿名公開は未承認で、本番ビルドには出さない。 */
export type DiagramAccess = 'public' | 'owner-only';

export interface Diagram {
  title: string;
  lead: string;
  url: string;
  access: DiagramAccess;
  /** 実画面の切り出し。public/ からの配信パス。 */
  thumbnail: string;
  thumbnailAlt: string;
}

// サムネイルの実寸。カード幅の約 2 倍。
export const THUMBNAIL_WIDTH = 840;
export const THUMBNAIL_HEIGHT = 525;

export const lineage: Diagram = {
  title: 'lolice lineage',
  lead: '自宅 Kubernetes クラスタ lolice と周辺インフラを構成要素の単位で分解し、由来、依存、データの流れを根拠つきで辿れるようにした図です。',
  url: 'https://lolice-lineage.b0xp.io/',
  access: 'public',
  thumbnail: '/diagrams/lolice-lineage.webp',
  thumbnailAlt: 'lolice lineage の実画面の一部。アプリ、基盤、物理ノードの層にサービス名のタグが並んでいる。',
};

// サムネイルは public repo に置かない。stage の deploy が環境 secret から public/diagrams/ へ復元する。
export const architecture: Diagram = {
  title: 'lolice architecture',
  lead: '同じクラスタを役割の単位で束ね、利用者、エッジと認証、アプリと基盤、CI と GitOps、データ、外部サービスの構造と主な流れを一望できるようにした図です。',
  url: 'https://lolice-architecture.b0xp.io/',
  access: 'owner-only',
  thumbnail: '/diagrams/lolice-architecture.webp',
  thumbnailAlt: 'lolice architecture の実画面の一部。役割ごとの色枠の中にサービスのアイコンと名前が並び、矢印と短いラベルで結ばれている。',
};

/** 本番ビルドに architecture の導線と URL を含めない。 */
export const diagrams: Diagram[] = isStage ? [lineage, architecture] : [lineage];
