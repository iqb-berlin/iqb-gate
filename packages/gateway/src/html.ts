const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
};

/** A text as it can stand in HTML, as an element's content or an attribute's value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

/**
 * A value as JSON that can stand inside `<script type="application/json">`: no `</script>` or
 * `<!--` can end the block early, whatever the texts hold.
 */
export function jsonForScriptBlock(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
