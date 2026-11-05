import { isStage } from './site';

/** 公開可否の区分。architecture の匿名公開は未承認で、本番ビルドには出さない。 */
export type DiagramAccess = 'public' | 'owner-only';

export interface Diagram {
  slug: string;
  title: string;
  lead: string;
  points: string[];
  url: string;
  access: DiagramAccess;
}

export const lineage: Diagram = {
  slug: 'lineage',
  title: 'lolice lineage',
  lead: '自宅 Kubernetes クラスタ lolice と周辺インフラを構成要素の単位で分解し、由来、依存、データの流れを根拠つきで辿れるようにした図です。',
  points: [
    '構成要素ごとに役割、関係、根拠となる IaC のファイルと行を確認できます',
    '上流と下流を辿って、依存と影響範囲を追えます',
    '秘密の配布やデプロイなどの代表的な経路を順番に見られます',
  ],
  url: 'https://lolice-lineage.b0xp.io/',
  access: 'public',
};

export const architecture: Diagram = {
  slug: 'architecture',
  title: 'lolice architecture',
  lead: '同じクラスタを役割の単位で束ね、利用者、エッジと認証、アプリと基盤、CI と GitOps、データ、外部サービスの構造と主な流れを一望できるようにした図です。',
  points: [
    '全体の階層と通信、認証、配備、データの大きな流れを 1 画面で見られます',
    '部品を選ぶと、束ねている要素と根拠を確認できます',
    '個々の要素の来歴は lineage へ辿れます',
  ],
  url: 'https://lolice-architecture.b0xp.io/',
  access: 'owner-only',
};

/** 本番ビルドに architecture の導線と URL を含めない。 */
export const diagrams: Diagram[] = isStage ? [lineage, architecture] : [lineage];
