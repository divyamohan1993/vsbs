import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getArticle, HELP_ARTICLES } from "../../../content/help";
import { ArticleFeedback } from "./ArticleFeedback";

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
    <article className="mx-auto w-full max-w-[720px] space-y-10 px-2 py-6">
      <p className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wide)] text-pearl-soft">
        <Link href={{ pathname: "/help" }} className="hover:text-pearl">
          ← {t("help.backToIndex")}
        </Link>
      </p>
      <div className="luxe-article space-y-6">{renderMarkdown(article.body)}</div>
      <ArticleFeedback />
      <style>{`
        .luxe-article h1 {
          font-family: var(--font-display);
          font-size: var(--text-display);
          font-weight: 500;
          letter-spacing: var(--tracking-tight);
          color: var(--color-pearl);
          line-height: 1.05;
          margin: 0;
        }
        @media (max-width: 640px) {
          .luxe-article h1 { font-size: var(--text-h1); }
        }
        .luxe-article h2 {
          font-family: var(--font-display);
          font-size: var(--text-h3);
          font-weight: 500;
          letter-spacing: var(--tracking-tight);
          color: var(--color-pearl);
          line-height: 1.2;
          margin-top: 2.25rem;
          margin-bottom: 0;
        }
        .luxe-article p {
          font-size: 1.125rem;
          line-height: 1.7;
          color: var(--color-pearl);
        }
        .luxe-article ul, .luxe-article ol {
          padding-left: 1.25rem;
          color: var(--color-pearl);
        }
        .luxe-article li {
          font-size: 1.125rem;
          line-height: 1.7;
          color: var(--color-pearl);
          margin-bottom: 0.5rem;
        }
        .luxe-article ul li::marker {
          color: var(--color-copper);
        }
        .luxe-article ol li::marker {
          color: var(--color-pearl-soft);
          font-family: var(--font-mono);
        }
        .luxe-article strong {
          color: var(--color-pearl);
          font-weight: 600;
        }
        .luxe-article code {
          font-family: var(--font-mono);
          font-size: 0.95rem;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--color-hairline);
          border-radius: 6px;
          padding: 1px 6px;
          color: var(--color-pearl);
        }
      `}</style>
    </article>
  );
}

function renderMarkdown(src: string): React.JSX.Element {
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
