import { NightProfitApp } from "../nightprofit-app";
import { AuthenticatedApp } from "../authenticated-app";

export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path=`/${slug.join("/")}`;
  if(path.startsWith("/app"))return <AuthenticatedApp path={path}/>;
  return <NightProfitApp initialPath={path} />;
}
