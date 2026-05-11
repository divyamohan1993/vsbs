"use client";

import { METADATA } from "../../lib/report/content";

// Toolbar above the printed pages. Hidden on print via @media print.
// PDF download triggers window.print() so the user uses the browser's
// "Save as PDF" gives pixel-equivalent output to the on-screen A4, no server
// dependency. DOCX download links to the /api/report/docx route which
// generates a Word document via the docx package.

export function ReportToolbar() {
	function downloadPdf() {
		if (typeof window === "undefined") return;
		window.print();
	}

	return (
		<div className="report-toolbar" role="toolbar" aria-label="Report actions">
			<span className="report-toolbar__title">{METADATA.title} · Capstone Report</span>
			<button
				type="button"
				className="report-toolbar__btn"
				onClick={downloadPdf}
				aria-label="Download as PDF using the browser print dialog"
			>
				Download PDF
			</button>
			<a
				className="report-toolbar__btn report-toolbar__btn--ghost"
				href="/api/report/docx"
				download="VSBS-Capstone-Report.docx"
				aria-label="Download as Microsoft Word document"
			>
				Download DOCX
			</a>
		</div>
	);
}
