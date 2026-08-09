/**
 * The YAML block at the top of a document, shown rather than swallowed.
 *
 * `markdown.rs` *detaches* the frontmatter node before rendering, so it appears
 * nowhere in the HTML — and until this component existed, nowhere at all: Rust
 * parsed it, `ipc.ts` validated it, and no component ever read it. A file whose
 * first six lines say `status: working document` opened looking as though it had
 * none. For a viewer whose claim is fidelity, on the one construct that is close
 * to universal in AI- and agent-authored Markdown, that is closer to a bug than
 * to a missing feature.
 *
 * **Shown verbatim, never parsed.** A `key: value` list would read better, and
 * would be wrong the moment a document uses a nested map, a flow sequence, an
 * anchor, or a multi-line block scalar — all ordinary YAML. Misreporting a
 * document's own metadata is a worse failure than showing it plainly, so the
 * text is passed through exactly as it was written and the reader can judge it.
 *
 * **Collapsed by default**, because on most documents this is not what the
 * reader came for. The open state is the `<details>` element's own, so it lasts
 * as long as this element does: the caller keys it on the document's path, which
 * is what stops one document's expanded block from greeting the next one opened
 * in the same tab. It does not survive switching to the source view and back.
 */
export function Frontmatter({ text }: { text: string }) {
  return (
    <details className="doc-frontmatter">
      {/* No count and no preview in the summary: both would mean interpreting
          the YAML, which is exactly what this component refuses to do. */}
      <summary>Frontmatter</summary>
      <pre>{text}</pre>
    </details>
  );
}
