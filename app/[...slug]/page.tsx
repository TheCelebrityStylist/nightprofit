import { NightProfitApp } from "../nightprofit-app";

export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return <NightProfitApp initialPath={`/${slug.join("/")}`} />;
}
