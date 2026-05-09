import { PitchDeck } from "./PitchDeck";

export const dynamic = "force-static";
export const revalidate = false;

export default function PitchPage() {
	return <PitchDeck />;
}
