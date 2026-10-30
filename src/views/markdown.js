import { escape, raw } from './html.js';

// Markdown mínimo y seguro para las respuestas del asistente: se escapa todo y luego se
// reconocen solo negritas, cursivas, código en línea, encabezados cortos y listas.
function inline(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(src) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(src ?? '').split(/\r?\n/)) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
    } else {
      close();
      if (heading) out.push(`<h3>${inline(heading[1])}</h3>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return raw(out.join(''));
}
