/** 図そのものの公開区分。両図とも一般公開済みで、portfolio 本番への掲載も BOXP-442 で承認済み。 */
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

// サムネイルは repo に置かない。stage と本番の deploy がビルド後に環境 secret から dist/diagrams/ へ復元する。
export const architecture: Diagram = {
  title: 'lolice architecture',
  lead: '同じクラスタを役割の単位で束ね、利用者、エッジと認証、アプリと基盤、CI と GitOps、データ、外部サービスの構造と主な流れを一望できるようにした図です。',
  url: 'https://lolice-architecture.b0xp.io/',
  access: 'public',
  thumbnail: '/diagrams/lolice-architecture.webp',
  thumbnailAlt: 'lolice architecture の実画面の一部。役割ごとの色枠の中にサービスのアイコンと名前が並び、矢印と短いラベルで結ばれている。',
};

/** stage と本番で同じ両図のカードを出す (BOXP-442 承認、BOXP-539 で本番を main に追従)。 */
export const diagrams: Diagram[] = [lineage, architecture];
