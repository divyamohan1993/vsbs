// =============================================================================
// /api/report/docx : server-side DOCX generation that matches the template.
//
// Uses the `docx` package to emit a Word document with the same structure
// the on-screen /report renders: A4, 2 cm margins, title page, front
// matter, eleven chapters, ten reflection questions, references. Headings
// use the template accent #0F4761; body is 11pt; tables use a header row
// shaded with the same accent.
// =============================================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	AlignmentType,
	BorderStyle,
	Document,
	Footer,
	Header,
	HeadingLevel,
	ImageRun,
	LevelFormat,
	PageBreak,
	PageNumber,
	PageOrientation,
	Packer,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from "docx";

import {
	ABSTRACT,
	ACKNOWLEDGEMENT,
	type Block,
	CHAPTER_PAGE_NUMBERS,
	CHAPTERS,
	FIGURE_PAGE_NUMBERS,
	LIST_OF_FIGURES,
	LIST_OF_TABLES,
	METADATA,
	REFERENCES,
	REFERENCES_PAGE,
	REFLECTION_PAGE,
	REFLECTION_QUESTIONS,
	type Section,
	TABLE_PAGE_NUMBERS,
} from "../../../../lib/report/content";

export const dynamic = "force-static";
export const runtime = "nodejs";
export const revalidate = 3600;

const ACCENT = "0F4761";
const BODY_FONT = "Times New Roman";
const HEADING_FONT = "Times New Roman";
const BODY_SIZE = 24; // 12pt in half-points
const H1_SIZE = 28; // 14pt — chapter title (centered)
const H2_SIZE = 26; // 13pt — topic heading
const H3_SIZE = 24; // 12pt — topic subheading
const TITLE_SIZE = 36; // 18pt — project title on the cover
const COVER_SIZE = 28; // 14pt — degree, fields, footer on the cover
const CAPTION_SIZE = 22; // 11pt — table + figure captions
const TABLE_SIZE = 22; // 11pt — table body

function p(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spaceAfter?: number; pageBreakBefore?: boolean } = {}): Paragraph {
	return new Paragraph({
		alignment: opts.alignment ?? AlignmentType.JUSTIFIED,
		...(opts.pageBreakBefore ? { pageBreakBefore: true } : {}),
		spacing: { after: opts.spaceAfter ?? 160, line: 300 },
		children: [
			new TextRun({
				text,
				...(opts.bold ? { bold: true } : {}),
				...(opts.italic ? { italics: true } : {}),
				size: opts.size ?? BODY_SIZE,
				...(opts.color ? { color: opts.color } : {}),
				font: opts.bold ? HEADING_FONT : BODY_FONT,
			}),
		],
	});
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel], size: number, opts: { pageBreakBefore?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
	return new Paragraph({
		heading: level,
		alignment: opts.alignment ?? AlignmentType.LEFT,
		...(opts.pageBreakBefore ? { pageBreakBefore: true } : {}),
		spacing: { before: 240, after: 120 },
		children: [
			new TextRun({
				text,
				bold: true,
				color: ACCENT,
				size,
				font: HEADING_FONT,
			}),
		],
	});
}

function bullet(text: string): Paragraph {
	return new Paragraph({
		alignment: AlignmentType.JUSTIFIED,
		bullet: { level: 0 },
		spacing: { after: 80, line: 300 },
		children: [new TextRun({ text, size: BODY_SIZE, font: BODY_FONT })],
	});
}

function numbered(text: string, refStyle = "ordered-list"): Paragraph {
	return new Paragraph({
		alignment: AlignmentType.JUSTIFIED,
		numbering: { reference: refStyle, level: 0 },
		spacing: { after: 80, line: 300 },
		children: [new TextRun({ text, size: BODY_SIZE, font: BODY_FONT })],
	});
}

function tableCellPara(text: string, opts: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
	return new Paragraph({
		alignment: opts.align ?? AlignmentType.LEFT,
		spacing: { after: 0, line: 260 },
		children: [
			new TextRun({
				text,
				...(opts.bold ? { bold: true } : {}),
				...(opts.color ? { color: opts.color } : {}),
				size: TABLE_SIZE, // 11pt for table content
				font: opts.bold ? HEADING_FONT : BODY_FONT,
			}),
		],
	});
}

function buildTable(headers: string[], rows: string[][]): Table {
	const headerRow = new TableRow({
		tableHeader: true,
		children: headers.map(
			(h) =>
				new TableCell({
					shading: { type: ShadingType.CLEAR, fill: ACCENT, color: "auto" },
					margins: { top: 100, bottom: 100, left: 120, right: 120 },
					children: [tableCellPara(h, { bold: true, color: "FFFFFF" })],
				}),
		),
	});
	const bodyRows = rows.map(
		(row, idx) =>
			new TableRow({
				children: row.map(
					(cell) =>
						new TableCell({
							...(idx % 2 === 1
								? { shading: { type: ShadingType.CLEAR, fill: "F7F9FB", color: "auto" } }
								: {}),
							margins: { top: 90, bottom: 90, left: 120, right: 120 },
							children: [tableCellPara(cell)],
						}),
				),
			}),
	);
	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		layout: TableLayoutType.AUTOFIT,
		rows: [headerRow, ...bodyRows],
		borders: {
			top: { style: BorderStyle.SINGLE, size: 4, color: "0F4761" },
			bottom: { style: BorderStyle.SINGLE, size: 4, color: "0F4761" },
			left: { style: BorderStyle.SINGLE, size: 4, color: "D0D4D9" },
			right: { style: BorderStyle.SINGLE, size: 4, color: "D0D4D9" },
			insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "D0D4D9" },
			insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "D0D4D9" },
		},
	});
}

async function renderBlockToDocx(block: Block): Promise<(Paragraph | Table)[]> {
	switch (block.kind) {
		case "p":
			return [p(block.text)];
		case "h2":
			return [heading(block.text, HeadingLevel.HEADING_1, H1_SIZE)];
		case "h3":
			return [heading(block.text, HeadingLevel.HEADING_2, H2_SIZE)];
		case "h4":
			return [heading(block.text, HeadingLevel.HEADING_3, H3_SIZE)];
		case "ul":
			return block.items.map((item) => bullet(item));
		case "ol":
			return block.items.map((item) => numbered(item));
		case "table": {
			// Caption sits BELOW the table, 11pt italic, centered.
			const out: (Paragraph | Table)[] = [];
			out.push(buildTable(block.headers, block.rows));
			if (block.caption) {
				out.push(
					new Paragraph({
						alignment: AlignmentType.CENTER,
						spacing: { before: 60, after: 160 },
						children: [
							new TextRun({
								text: block.caption,
								italics: true,
								size: CAPTION_SIZE,
								color: "404040",
								font: BODY_FONT,
							}),
						],
					}),
				);
			} else {
				out.push(p("", { spaceAfter: 120 }));
			}
			return out;
		}
		case "figure":
			return [
				new Paragraph({
					alignment: AlignmentType.CENTER,
					spacing: { before: 120, after: 60 },
					border: {
						top: { style: BorderStyle.DASHED, size: 4, color: "B0B6BD" },
						bottom: { style: BorderStyle.DASHED, size: 4, color: "B0B6BD" },
						left: { style: BorderStyle.DASHED, size: 4, color: "B0B6BD" },
						right: { style: BorderStyle.DASHED, size: 4, color: "B0B6BD" },
					},
					children: [
						new TextRun({
							text: block.description,
							italics: true,
							size: BODY_SIZE,
							color: "404040",
							font: BODY_FONT,
						}),
					],
				}),
				new Paragraph({
					alignment: AlignmentType.CENTER,
					spacing: { after: 160 },
					children: [
						new TextRun({
							text: block.caption,
							italics: true,
							size: CAPTION_SIZE,
							color: "404040",
							font: BODY_FONT,
						}),
					],
				}),
			];
		case "quote":
			return [
				new Paragraph({
					alignment: AlignmentType.CENTER,
					spacing: { before: 120, after: 120 },
					children: [
						new TextRun({
							text: block.text,
							italics: true,
							size: BODY_SIZE,
							color: "404040",
							font: BODY_FONT,
						}),
					],
				}),
			];
		case "code":
			return [
				new Paragraph({
					spacing: { before: 80, after: 120, line: 280 },
					shading: { type: ShadingType.CLEAR, fill: "0C1118", color: "auto" },
					children: [
						new TextRun({
							text: block.text,
							size: 19,
							color: "E6EDF3",
							font: "Cascadia Mono",
						}),
					],
				}),
			];
		case "image":
		case "svg":
			return imageOrSvgParagraphs(block);
	}
}

async function resolveImage(srcUnderPublic: string): Promise<Buffer | null> {
	// SVG blocks reference /report/figures/<x>.svg; we embed the pre-rasterised
	// /report/figures/png/<x>.png so Word renders them. Image blocks reference
	// /report/screenshots/<x>.png which we embed verbatim.
	const isSvg = srcUnderPublic.endsWith(".svg");
	const relPath = isSvg
		? srcUnderPublic
				.replace(/^\/report\/figures\//, "/report/figures/png/")
				.replace(/\.svg$/, ".png")
		: srcUnderPublic;
	const abs = join(process.cwd(), "public", relPath.replace(/^\//, ""));
	try {
		return await readFile(abs);
	} catch {
		return null;
	}
}

async function imageOrSvgParagraphs(
	block:
		| { kind: "image"; src: string; alt: string; caption: string; widthPx?: number; heightPx?: number }
		| { kind: "svg"; src: string; caption: string; widthPx?: number; heightPx?: number },
): Promise<Paragraph[]> {
	const buf = await resolveImage(block.src);
	if (!buf) {
		return [
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { before: 120, after: 60 },
				children: [
					new TextRun({
						text: `[Figure asset missing: ${block.src}]`,
						italics: true,
						size: BODY_SIZE,
						color: "B23A48",
						font: BODY_FONT,
					}),
				],
			}),
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { after: 160 },
				children: [
					new TextRun({
						text: block.caption,
						italics: true,
						size: CAPTION_SIZE,
						color: "404040",
						font: BODY_FONT,
					}),
				],
			}),
		];
	}
	// Target width ~ 6 in inside A4 with 1 in margins (about 15.2 cm).
	// 96 DPI gives ~576 px; we keep aspect ratio from the source dimensions.
	const targetWidthPx = 576;
	const aspect = block.widthPx && block.heightPx ? block.heightPx / block.widthPx : 0.6;
	const targetHeightPx = Math.round(targetWidthPx * aspect);
	const ab = new ArrayBuffer(buf.byteLength);
	new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
	return [
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { before: 120, after: 60 },
			children: [
				new ImageRun({
					data: ab,
					transformation: { width: targetWidthPx, height: targetHeightPx },
					type: "png",
				}),
			],
		}),
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { after: 160 },
			children: [
				new TextRun({
					text: block.caption,
					italics: true,
					size: CAPTION_SIZE,
					color: "404040",
					font: BODY_FONT,
				}),
			],
		}),
	];
}

// Chapter heading: 14pt bold, centered. Topic and subtopic headings
// follow the h3/h4 sizes set in renderBlockToDocx.
async function chapterParagraphs(section: Section, isFirst = false): Promise<(Paragraph | Table)[]> {
	const out: (Paragraph | Table)[] = [];
	out.push(
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			...(isFirst ? {} : { pageBreakBefore: true }),
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 200 },
			children: [
				new TextRun({
					text:
						section.chapter !== undefined
							? `Chapter ${section.chapter}: ${section.heading}`
							: section.heading,
					bold: true,
					color: ACCENT,
					size: H1_SIZE,
					font: HEADING_FONT,
				}),
			],
		}),
	);
	for (const b of section.blocks) {
		out.push(...(await renderBlockToDocx(b)));
	}
	return out;
}

async function frontMatterPage(heading_: string, blocks: Block[]): Promise<(Paragraph | Table)[]> {
	const out: (Paragraph | Table)[] = [];
	out.push(
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 200 },
			children: [
				new TextRun({
					text: heading_,
					bold: true,
					color: ACCENT,
					size: H1_SIZE,
					font: HEADING_FONT,
				}),
			],
		}),
	);
	for (const b of blocks) {
		out.push(...(await renderBlockToDocx(b)));
	}
	return out;
}

async function buildTitlePage(): Promise<(Paragraph | Table)[]> {
	// Cover layout mirrors the on-screen /report cover. Word does not
	// support flex space-around natively, so we approximate equalised
	// vertical gaps using a fixed number of empty spacer paragraphs
	// between the four logical groups: header, logo, fields, footer.
	// The spacer count is tuned so the school+university block sits near
	// the bottom of the A4 page with visually equal whitespace above
	// each group.
	let logoBuf: Buffer | null = null;
	try {
		logoBuf = await readFile(join(process.cwd(), "public", "report", "shoolini-logo.png"));
	} catch {
		logoBuf = null;
	}

	const centered = (text: string, opts: { size?: number; spaceAfter?: number } = {}): Paragraph =>
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { after: opts.spaceAfter ?? 80 },
			children: [
				new TextRun({
					text,
					bold: true,
					size: opts.size ?? COVER_SIZE,
					font: HEADING_FONT,
				}),
			],
		});

	const blank = (): Paragraph =>
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { after: 0, line: 360 },
			children: [new TextRun({ text: " ", size: COVER_SIZE })],
		});

	const out: Paragraph[] = [];

	// Header group: title sits with a clear gap above the degree line,
	// then the degree lines stay tight together below it.
	out.push(centered(METADATA.title, { size: TITLE_SIZE, spaceAfter: 720 }));
	out.push(centered("Project Report submitted for the partial fulfilment of the degree of", { spaceAfter: 60 }));
	out.push(centered("BACHELOR OF TECHNOLOGY (CSE)", { spaceAfter: 0 }));

	// Gap 1: header → logo
	out.push(blank(), blank(), blank());

	// Logo group.
	if (logoBuf) {
		out.push(
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { after: 0 },
				children: [
					new ImageRun({
						data: logoBuf,
						transformation: { width: 220, height: 117 },
						type: "png",
					}),
				],
			}),
		);
	}

	// Gap 2: logo → fields
	out.push(blank(), blank(), blank());

	// Student fields group, left-aligned and packed tight.
	const meta: [string, string][] = [
		["Name of Student:", METADATA.studentName],
		["Registration Number:", METADATA.registrationNumber],
		["Course with Specialization:", METADATA.courseSpecialization],
		["Capstone Mentor:", METADATA.capstoneMentor],
	];
	for (const [k, v] of meta) {
		out.push(
			new Paragraph({
				alignment: AlignmentType.LEFT,
				spacing: { after: 80 },
				indent: { left: 1440 },
				children: [
					new TextRun({ text: `${k} `, bold: true, size: COVER_SIZE, font: HEADING_FONT }),
					new TextRun({ text: v, size: COVER_SIZE, font: HEADING_FONT }),
				],
			}),
		);
	}

	// Gap 3: fields → footer
	out.push(blank(), blank(), blank());

	// Footer group: school + university + location + date, packed tight.
	out.push(centered("YOGANANDA SCHOOL OF AI, COMPUTERS AND DATA SCIENCES", { spaceAfter: 40 }));
	out.push(centered("SHOOLINI UNIVERSITY", { spaceAfter: 40 }));
	out.push(centered("SOLAN, INDIA", { spaceAfter: 40 }));
	out.push(centered("MAY 2026", { spaceAfter: 0 }));

	return out;
}

async function buildDocument(): Promise<Document> {
	const titleParas = await buildTitlePage();

	const reflectionParas: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 120 },
			children: [
				new TextRun({ text: "Reflection Questions", bold: true, color: ACCENT, size: H1_SIZE, font: HEADING_FONT }),
			],
		}),
	];
	for (let i = 0; i < REFLECTION_QUESTIONS.length; i += 1) {
		const qa = REFLECTION_QUESTIONS[i]!;
		reflectionParas.push(
			new Paragraph({
				spacing: { before: 120, after: 60 },
				children: [
					new TextRun({
						text: `Q${i + 1}. ${qa.question}`,
						bold: true,
						color: ACCENT,
						size: BODY_SIZE,
						font: HEADING_FONT,
					}),
				],
			}),
			p(qa.answer, { spaceAfter: 60 }),
		);
	}

	const referenceParas: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 120 },
			children: [
				new TextRun({ text: "References", bold: true, color: ACCENT, size: H1_SIZE, font: HEADING_FONT }),
			],
		}),
	];
	for (let i = 0; i < REFERENCES.length; i += 1) {
		referenceParas.push(
			new Paragraph({
				spacing: { after: 80, line: 280 },
				indent: { left: 360, hanging: 360 },
				children: [
					new TextRun({
						text: `[${i + 1}] `,
						bold: true,
						color: ACCENT,
						size: 21,
						font: HEADING_FONT,
					}),
					new TextRun({ text: REFERENCES[i] ?? "", size: 21, font: BODY_FONT }),
				],
			}),
		);
	}

	// Front matter
	const ackParas = await frontMatterPage(ACKNOWLEDGEMENT.heading, ACKNOWLEDGEMENT.blocks);
	const absParas = await frontMatterPage(ABSTRACT.heading, ABSTRACT.blocks);

	// TOC + lists
	const tocParas: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 120 },
			children: [
				new TextRun({ text: "Table of Contents", bold: true, color: ACCENT, size: H1_SIZE, font: HEADING_FONT }),
			],
		}),
	];
	for (const s of [
		{ label: "Acknowledgement", page: "ii" },
		{ label: "Abstract", page: "iii" },
		{ label: "List of Figures", page: "v" },
		{ label: "List of Tables", page: "vi" },
	]) {
		tocParas.push(
			new Paragraph({
				tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
				spacing: { after: 60 },
				children: [
					new TextRun({ text: s.label, size: BODY_SIZE, font: BODY_FONT }),
					new TextRun({ text: `\t${s.page}`, size: BODY_SIZE, font: BODY_FONT }),
				],
			}),
		);
	}
	for (const ch of CHAPTERS) {
		const map = ch.chapter !== undefined ? CHAPTER_PAGE_NUMBERS[ch.chapter] : undefined;
		tocParas.push(
			new Paragraph({
				tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
				spacing: { before: 60, after: 30 },
				children: [
					new TextRun({
						text: `Chapter ${ch.chapter}: ${ch.heading}`,
						bold: true,
						size: BODY_SIZE,
						font: HEADING_FONT,
					}),
					new TextRun({
						text: `\t${map ? map.start : ""}`,
						bold: true,
						size: BODY_SIZE,
						font: HEADING_FONT,
					}),
				],
			}),
		);
		const subs = ch.blocks.filter((b) => b.kind === "h3") as { text: string }[];
		subs.forEach((s, si) => {
			const sub = map?.subs[si];
			tocParas.push(
				new Paragraph({
					indent: { left: 360 },
					tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
					spacing: { after: 30 },
					children: [
						new TextRun({ text: s.text, size: BODY_SIZE, font: BODY_FONT, color: "333333" }),
						new TextRun({
							text: `\t${sub !== undefined ? sub : ""}`,
							size: BODY_SIZE,
							font: BODY_FONT,
							color: "333333",
						}),
					],
				}),
			);
		});
	}
	tocParas.push(
		new Paragraph({
			tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
			spacing: { before: 60, after: 30 },
			children: [
				new TextRun({ text: "Reflection Questions", bold: true, size: BODY_SIZE, font: HEADING_FONT }),
				new TextRun({ text: `\t${REFLECTION_PAGE}`, bold: true, size: BODY_SIZE, font: HEADING_FONT }),
			],
		}),
		new Paragraph({
			tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
			spacing: { after: 30 },
			children: [
				new TextRun({ text: "References", bold: true, size: BODY_SIZE, font: HEADING_FONT }),
				new TextRun({ text: `\t${REFERENCES_PAGE}`, bold: true, size: BODY_SIZE, font: HEADING_FONT }),
			],
		}),
	);

	const lofParas: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 120 },
			children: [
				new TextRun({ text: "List of Figures", bold: true, color: ACCENT, size: H1_SIZE, font: HEADING_FONT }),
			],
		}),
	];
	for (const f of LIST_OF_FIGURES) {
		const fp = FIGURE_PAGE_NUMBERS[f.number];
		lofParas.push(
			new Paragraph({
				tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
				spacing: { after: 60 },
				children: [
					new TextRun({ text: `Figure ${f.number}: ${f.caption}`, size: BODY_SIZE, font: BODY_FONT }),
					new TextRun({
						text: `\t${fp !== undefined ? fp : ""}`,
						size: BODY_SIZE,
						font: BODY_FONT,
					}),
				],
			}),
		);
	}

	const lotParas: Paragraph[] = [
		new Paragraph({
			heading: HeadingLevel.HEADING_1,
			pageBreakBefore: true,
			alignment: AlignmentType.CENTER,
			spacing: { before: 240, after: 120 },
			children: [
				new TextRun({ text: "List of Tables", bold: true, color: ACCENT, size: H1_SIZE, font: HEADING_FONT }),
			],
		}),
	];
	for (const t of LIST_OF_TABLES) {
		const tp = TABLE_PAGE_NUMBERS[t.number];
		lotParas.push(
			new Paragraph({
				tabStops: [{ type: "right" as const, position: 9000, leader: "dot" as const }],
				spacing: { after: 60 },
				children: [
					new TextRun({ text: `Table ${t.number}: ${t.caption}`, size: BODY_SIZE, font: BODY_FONT }),
					new TextRun({
						text: `\t${tp !== undefined ? tp : ""}`,
						size: BODY_SIZE,
						font: BODY_FONT,
					}),
				],
			}),
		);
	}

	const chapterContent: (Paragraph | Table)[] = [];
	for (let i = 0; i < CHAPTERS.length; i += 1) {
		const ch = CHAPTERS[i]!;
		chapterContent.push(...(await chapterParagraphs(ch, false)));
	}

	const doc = new Document({
		creator: METADATA.studentName,
		title: METADATA.title,
		description: METADATA.subtitle,
		styles: {
			default: {
				document: {
					run: { font: BODY_FONT, size: BODY_SIZE },
				},
			},
		},
		numbering: {
			config: [
				{
					reference: "ordered-list",
					levels: [
						{
							level: 0,
							format: LevelFormat.DECIMAL,
							text: "%1.",
							alignment: AlignmentType.START,
							style: {
								paragraph: { indent: { left: 720, hanging: 360 } },
							},
						},
					],
				},
			],
		},
		sections: [
			{
				properties: {
					page: {
						// A4 (210x297mm = 11906x16838 twips) with a 1-inch margin on
						// every side (1in = 1440 twips). Header and footer sit half
						// an inch inside the top/bottom margin so chapter title and
						// page number appear in the margin band, not the body.
						size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 },
						margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
					},
				},
				headers: {
					default: new Header({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [
									new TextRun({
										text: METADATA.title,
										size: 18,
										color: "595959",
										font: BODY_FONT,
									}),
								],
							}),
						],
					}),
				},
				footers: {
					default: new Footer({
						children: [
							new Paragraph({
								alignment: AlignmentType.CENTER,
								children: [
									new TextRun({
										children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
										size: 18,
										color: "595959",
										font: BODY_FONT,
									}),
								],
							}),
						],
					}),
				},
				children: [
					...titleParas,
					...ackParas,
					...absParas,
					...tocParas,
					...lofParas,
					...lotParas,
					...chapterContent,
					...reflectionParas,
					...referenceParas,
				],
			},
		],
	});

	return doc;
}

export async function GET() {
	const doc = await buildDocument();
	const buffer = await Packer.toBuffer(doc);
	// Copy into a fresh ArrayBuffer so the Response BodyInit type accepts it
	// regardless of whether docx returns a Node Buffer or a Uint8Array.
	const ab = new ArrayBuffer(buffer.byteLength);
	new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
	return new Response(ab, {
		status: 200,
		headers: {
			"content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"content-disposition": 'attachment; filename="VSBS-Capstone-Report.docx"',
			"cache-control": "public, max-age=3600",
			"x-content-type-options": "nosniff",
		},
	});
}
