import { AuthFragmentBridge } from "./auth-fragment-bridge";
import { RootRedirect } from "./root-redirect";

/** The tool opens straight on the roster; password-reset links still land here first. */
export default function Home() {
  return <><AuthFragmentBridge/><RootRedirect/></>;
}
