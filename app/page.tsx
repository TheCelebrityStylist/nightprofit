import { NightProfitApp } from "./nightprofit-app";
import { AuthFragmentBridge } from "./auth-fragment-bridge";

export default function Home() {
  return <><AuthFragmentBridge/><NightProfitApp /></>;
}
