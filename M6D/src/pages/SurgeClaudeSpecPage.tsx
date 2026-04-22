import { useEffect, useMemo } from 'react';
import surgeSpecHtml from '../../../APP-DOC/CLAUDE BUILD/surge_cotrader_4page_spec.html?raw';

export default function SurgeClaudeSpecPage() {
  const { htmlBody, scriptBody } = useMemo(() => {
    const m = surgeSpecHtml.match(/<script>([\s\S]*?)<\/script>/i);
    const script = m?.[1] ?? '';
    const html = surgeSpecHtml.replace(/<script>[\s\S]*?<\/script>/gi, '');
    return { htmlBody: html, scriptBody: script };
  }, []);

  useEffect(() => {
    if (!scriptBody) return;
    const id = 'surge-claude-spec-inline-script';
    const old = document.getElementById(id);
    if (old) old.remove();
    const s = document.createElement('script');
    s.id = id;
    s.type = 'text/javascript';
    s.text = scriptBody;
    document.body.appendChild(s);
    return () => {
      const node = document.getElementById(id);
      if (node) node.remove();
    };
  }, [scriptBody]);

  return (
    <div style={{ height: '100%', minHeight: 0, overflow: 'auto', background: '#060d1a' }}>
      <div dangerouslySetInnerHTML={{ __html: htmlBody }} />
    </div>
  );
}
