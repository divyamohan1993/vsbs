import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getArticle, HELP_ARTICLES } from "../../../content/help";

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();
  const t = await getTranslations();

  return (
    <article className="space-y-6 py-6">
      <p className="text-muted text-sm">
        <Link href={{ pathname: "/help" }} className="hover:underline">
          {t("help.backToIndex")}
        </Link>
      </p>
      <div className="prose prose-invert max-w-none">{renderMarkdown(article.body)}</div>
    </article>
  );
}

function renderMarkdown(src: string): React.JSX.Element {
  // Minimal commonmark renderer. We support headings (#, ##), ordered
  // and unordered lists, paragraphs, bold (**), and inline backticks.
  const blocks = src.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: React.JSX.Element[] = [];
  blocks.forEach((block, i) => {
    if (/^#\s/.test(block)) {
      out.push(<h1 key={i}>{stripHeading(block, 1)}</h1>);
    } else if (/^##\s/.test(block)) {
      out.push(<h2 key={i}>{stripHeading(block, 2)}</h2>);
    } else if (/^\d+\.\s/.test(block)) {
      const items = block.split(/\n(?=\d+\.\s)/);
      out.push(
        <ol key={i}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it.replace(/^\d+\.\s+/, ""))}</li>
          ))}
        </ol>,
      );
    } else if (/^-\s/.test(block)) {
      const items = block.split(/\n(?=-\s)/);
      out.push(
        <ul key={i}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it.replace(/^-\s+/, ""))}</li>
          ))}
        </ul>,
      );
    } else {
      out.push(<p key={i}>{renderInline(block)}</p>);
    }
  });
  return <>{out}</>;
}

function stripHeading(b: string, level: 1 | 2): string {
  return b.replace(level === 1 ? /^#\s+/ : /^##\s+/, "").trim();
}

function renderInline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={`b-${m.index}`}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={`c-${m.index}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
