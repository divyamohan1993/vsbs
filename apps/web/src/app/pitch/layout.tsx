import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./pitch.css";

const fraunces = Fraunces({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-pitch-display",
	weight: "variable",
	style: ["normal", "italic"],
	axes: ["SOFT", "WONK", "opsz"],
});

const manrope = Manrope({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-pitch-body",
	weight: "variable",
});

export const metadata: Metadata = {
	title: "VSBS · Capstone Pitch",
	description:
		"VSBS in seventeen slides. The first research-cited, agentic, safety-first reference architecture for autonomous vehicle service booking. Divya Mohan / dmj.one.",
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	themeColor: "#08090C",
	colorScheme: "dark",
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

export default function PitchLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className={`pitch-shell ${fraunces.variable} ${manrope.variable}`} data-pitch-root="true">
			{children}
		</div>
	);
}
