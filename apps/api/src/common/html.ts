const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attributes (every email body that holds user input). */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
