import { PitchDeck } from "./PitchDeck";

// Dynamic so Next emits hydration scripts with the request-time CSP nonce
// from proxy.ts. Static rendering would bake in a build-time nonce that
// no longer matches the per-request nonce header, blocking every inline
// script under `'strict-dynamic'`.
export const dynamic = "force-dynamic";

export default function PitchPage() {
	return <PitchDeck />;
}
