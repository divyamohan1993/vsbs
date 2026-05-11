// =============================================================================
// /report : Capstone project report.
//
// Page-by-page A4 rendering matching the Shoolini capstone template
// (CAPSTONE PROJECT REPORT.docx). Every <section class="a4"> is exactly one
// printed page. Source content lives in apps/web/src/lib/report/content.ts
// and is also consumed by the docx generator at /api/report/docx so the two
// formats stay in lockstep.
//
// Print → Save as PDF gives a pixel-equivalent A4 PDF without any server
// dependency. The DOCX route below uses the `docx` package on the server.
// =============================================================================

import type { Metadata } from "next";
import Image from "next/image";

import {
	ABSTRACT,
	ACKNOWLEDGEMENT,
	type Block,
	CHAPTERS,
	LIST_OF_FIGURES,
	LIST_OF_TABLES,
	METADATA,
	REFERENCES,
	REFLECTION_QUESTIONS,
	type Section,
} from "../../lib/report/content";

import { ReportToolbar } from "./toolbar";

import "./report.css";

// Cannot be force-static: the root layout reads x-pathname from headers()
// to decide whether to skip the site chrome on /report, which opts the
// segment into dynamic rendering. Static export would lose that branch.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: `${METADATA.title} · Capstone Report`,
	description: METADATA.subtitle,
	robots: { index: true, follow: true },
};

function PageHeader({ chapter, title }: { chapter?: number; title: string }) {
	return (
		<div className="page-header" aria-hidden>
			<span>
				{chapter !== undefined ? `Chapter ${chapter}` : " "}
			</span>
			<span>{title}</span>
		</div>
	);
}

function PageFooter({ pageNumber }: { pageNumber: string | number }) {
	return (
		<div className="page-footer" aria-hidden>
			<span>{METADATA.title}</span>
			<span>Page {pageNumber}</span>
		</div>
	);
}

function renderBlock(block: Block, key: string) {
	switch (block.kind) {
		case "p":
			return <p key={key}>{block.text}</p>;
		case "h2":
			return (
				<h2 key={key} className="chapter">
					{block.text}
				</h2>
			);
		case "h3":
			return <h3 key={key}>{block.text}</h3>;
		case "h4":
			return <h4 key={key}>{block.text}</h4>;
		case "ul":
			return (
				<ul key={key}>
					{block.items.map((item, i) => (
						<li key={`${key}-${i}`}>{item}</li>
					))}
				</ul>
			);
		case "ol":
			return (
				<ol key={key}>
					{block.items.map((item, i) => (
						<li key={`${key}-${i}`}>{item}</li>
					))}
				</ol>
			);
		case "table":
			return (
				<div key={key}>					
					<table>
						<thead>
							<tr>
								{block.headers.map((h, i) => (
									<th key={`${key}-h-${i}`}>{h}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, ri) => (
								<tr key={`${key}-r-${ri}`}>
									{row.map((cell, ci) => (
										<td key={`${key}-r-${ri}-c-${ci}`}>{cell}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					{block.caption ? <p className="table-captions">{block.caption}</p> : null}
				</div>
			);
		case "figure":
			return (
				<figure key={key} className="figure-placeholder">
					<div>{block.description}</div>
					<figcaption>{block.caption}</figcaption>
				</figure>
			);
		case "image":
			return (
				<figure key={key} className="figure-image">
					{/* Local static asset; next/image proxy is unnecessary and would
					    add network for offline print. Plain <img> is sufficient. */}
					<img
						src={block.src}
						alt={block.alt}
						width={block.widthPx ?? 720}
						height={block.heightPx ?? 460}
						loading="eager"
					/>
					<figcaption>{block.caption}</figcaption>
				</figure>
			);
		case "svg":
			return (
				<figure key={key} className="figure-svg">
					<img
						src={block.src}
						alt={block.caption}
						width={block.widthPx ?? 760}
						height={block.heightPx}
						loading="eager"
					/>
					<figcaption>{block.caption}</figcaption>
				</figure>
			);
		case "quote":
			return (
				<blockquote key={key} className="q">
					{block.text}
				</blockquote>
			);
		case "code":
			return (
				<pre key={key} className="code">
					{block.text}
				</pre>
			);
	}
}

function FrontMatterPage({
	id,
	heading,
	pageNumber,
	children,
}: {
	id: string;
	heading: string;
	pageNumber: string;
	children: React.ReactNode;
}) {
	return (
		<section className="a4" id={id} aria-labelledby={`${id}-h`}>
			<PageHeader title={heading} />
			<div style={{ paddingTop: "10mm" }}>
				<h2 id={`${id}-h`} className="chapter">
					{heading}
				</h2>
				{children}
			</div>
			<PageFooter pageNumber={pageNumber} />
		</section>
	);
}

function TitlePage() {
	// Cover layout matches the Shoolini capstone template. The page is a
	// flex column with four top-level groups: header, logo, fields, footer.
	// `justify-content: space-around` on the container distributes the
	// groups evenly down the page so every visible gap is the same height.
	// Within a group, tightly-spaced lines stay tight via local margins.
	// All template text is 14pt bold black, except the project title which
	// is 18pt bold black. No accent colours are used on the cover.
	return (
		<section className="a4 title-page" id="title">
			<div className="title-header">
				<div className="title-block">{METADATA.title}</div>
				<div className="title-degree-label">
					Synopsis submitted for the partial fulfilment of the degree of
				</div>
				<div className="title-degree">BACHELOR OF TECHNOLOGY (CSE)</div>
			</div>

			<Image
				src="/report/shoolini-logo.png"
				alt="Shoolini University"
				width={578}
				height={307}
				className="title-logo"
				priority
			/>

			<dl className="title-meta">
				<dt>Name of Student:</dt>
				<dd>{METADATA.studentName}</dd>
				<dt>Registration Number:</dt>
				<dd>{METADATA.registrationNumber}</dd>
				<dt>Course with Specialization:</dt>
				<dd>{METADATA.courseSpecialization}</dd>
				<dt>Capstone Mentor:</dt>
				<dd>{METADATA.capstoneMentor}</dd>
			</dl>

			<div className="title-footer">
				<div className="title-school">YOGANANDA SCHOOL OF AI, COMPUTERS AND DATA SCIENCES</div>
				<div className="title-university">SHOOLINI UNIVERSITY</div>
				<div className="title-university">SOLAN, INDIA</div>
				<div className="title-university">MAY 2026</div>
			</div>
		</section>
	);
}

function TableOfContentsPage() {
	const rows: { lvl: 1 | 2; label: string; ref: string; page: string }[] = [
		{ lvl: 1, label: "Acknowledgement", ref: "ack", page: "ii" },
		{ lvl: 1, label: "Abstract", ref: "abs", page: "iii" },
		{ lvl: 1, label: "List of Figures", ref: "lof", page: "v" },
		{ lvl: 1, label: "List of Tables", ref: "lot", page: "vi" },
	];
	let p = 1;
	for (const ch of CHAPTERS) {
		rows.push({
			lvl: 1,
			label: `Chapter ${ch.chapter}: ${ch.heading}`,
			ref: ch.id,
			page: String(p),
		});
		const subs = ch.blocks.filter((b) => b.kind === "h3") as { text: string }[];
		for (const s of subs) {
			rows.push({ lvl: 2, label: s.text, ref: ch.id, page: String(p) });
		}
		p += 2;
	}
	rows.push({ lvl: 1, label: "Reflection Questions", ref: "qa", page: String(p) });
	rows.push({ lvl: 1, label: "References", ref: "refs", page: String(p + 2) });
	return (
		<section className="a4" id="toc">
			<PageHeader title="Table of Contents" />
			<div style={{ paddingTop: "10mm" }}>
				<h2 className="chapter">Table of Contents</h2>
				{rows.map((r, i) => (
					<div className={`toc-row toc-row--lvl${r.lvl}`} key={`toc-${i}`}>
						<span>{r.label}</span>
						<span className="toc-leader" aria-hidden />
						<span>{r.page}</span>
					</div>
				))}
			</div>
			<PageFooter pageNumber="iv" />
		</section>
	);
}

function ListOfFiguresPage() {
	return (
		<FrontMatterPage id="lof" heading="List of Figures" pageNumber="v">
			{LIST_OF_FIGURES.length === 0 ? (
				<p>No figures listed.</p>
			) : (
				LIST_OF_FIGURES.map((f, i) => (
					<div className="toc-row toc-row--lvl1" key={`fig-${i}`}>
						<span>
							Figure {f.number}: {f.caption}
						</span>
						<span className="toc-leader" aria-hidden />
						<span>--</span>
					</div>
				))
			)}
		</FrontMatterPage>
	);
}

function ListOfTablesPage() {
	return (
		<FrontMatterPage id="lot" heading="List of Tables" pageNumber="vi">
			{LIST_OF_TABLES.map((t, i) => (
				<div className="toc-row toc-row--lvl1" key={`tbl-${i}`}>
					<span>
						Table {t.number}: {t.caption}
					</span>
					<span className="toc-leader" aria-hidden />
					<span>--</span>
				</div>
			))}
		</FrontMatterPage>
	);
}

function ChapterPage({ section, pageNumber }: { section: Section; pageNumber: number }) {
	return (
		<section className="a4" id={section.id}>
			<PageHeader
				{...(section.chapter !== undefined ? { chapter: section.chapter } : {})}
				title={section.heading}
			/>
			<div style={{ paddingTop: "10mm" }}>
				<h2 className="chapter">
					{section.chapter !== undefined ? `Chapter ${section.chapter}: ` : ""}
					{section.heading}
				</h2>
				{section.blocks.map((b, i) => renderBlock(b, `${section.id}-${i}`))}
			</div>
			<PageFooter pageNumber={pageNumber} />
		</section>
	);
}

function ReflectionPage() {
	return (
		<section className="a4" id="qa">
			<PageHeader title="Reflection Questions" />
			<div style={{ paddingTop: "10mm" }}>
				<h2 className="chapter">Reflection Questions</h2>
				{REFLECTION_QUESTIONS.map((qa, i) => (
					<div className="qa-block" key={`qa-${i}`}>
						<p className="qa-question">
							Q{i + 1}. {qa.question}
						</p>
						<p className="qa-answer">{qa.answer}</p>
					</div>
				))}
			</div>
			<PageFooter pageNumber={CHAPTERS.length + 2} />
		</section>
	);
}

function ReferencesPage() {
	return (
		<section className="a4" id="refs">
			<PageHeader title="References" />
			<div style={{ paddingTop: "10mm" }}>
				<h2 className="chapter">References</h2>
				<ol className="refs-list">
					{REFERENCES.map((r, i) => (
						<li key={`ref-${i}`}>{r}</li>
					))}
				</ol>
			</div>
			<PageFooter pageNumber={CHAPTERS.length + 4} />
		</section>
	);
}

export default function ReportPage() {
	return (
		<main className="report-shell">
			<ReportToolbar />
			<div className="report-pages">
				<TitlePage />
				<FrontMatterPage id="ack" heading={ACKNOWLEDGEMENT.heading} pageNumber="ii">
					{ACKNOWLEDGEMENT.blocks.map((b, i) => renderBlock(b, `ack-${i}`))}
				</FrontMatterPage>
				<FrontMatterPage id="abs" heading={ABSTRACT.heading} pageNumber="iii">
					{ABSTRACT.blocks.map((b, i) => renderBlock(b, `abs-${i}`))}
				</FrontMatterPage>
				<TableOfContentsPage />
				<ListOfFiguresPage />
				<ListOfTablesPage />
				{CHAPTERS.map((c, i) => (
					<ChapterPage key={c.id} section={c} pageNumber={i + 1} />
				))}
				<ReflectionPage />
				<ReferencesPage />
			</div>
		</main>
	);
}
