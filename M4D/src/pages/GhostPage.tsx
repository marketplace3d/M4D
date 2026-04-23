import { useEffect, useMemo } from 'react'
import brokerLayersHtml from '../../../APP-DOC/CLAUDE BUILD/broker_protection_layers.html?raw'

const INLINE_SCRIPT = `
var __ghostOrder = ['threats', 'behavior', 'structure', 'frontrun', 'playbook', 'code'];
function show(id) {
  var secs = document.querySelectorAll('.ghost-broker .sec');
  for (var i = 0; i < secs.length; i++) secs[i].classList.remove('active');
  var tabs = document.querySelectorAll('.ghost-broker .nav .tab');
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
  var el = document.getElementById('tab-' + id);
  if (el) el.classList.add('active');
  var ix = __ghostOrder.indexOf(id);
  if (ix >= 0 && tabs[ix]) tabs[ix].classList.add('active');
}
function tog(node) { node.classList.toggle('open'); }
function sendPrompt(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function () {});
  }
}
`

export default function GhostPage() {
  const htmlBody = useMemo(() => {
    const withoutScript = brokerLayersHtml.replace(/<script>[\s\S]*?<\/script>/gi, '')
    return withoutScript.replace('<div class="shell">', '<div class="shell ghost-broker">')
  }, [])

  useEffect(() => {
    const scriptId = 'ghost-broker-inline-script'
    const old = document.getElementById(scriptId)
    if (old) old.remove()
    const s = document.createElement('script')
    s.id = scriptId
    s.type = 'text/javascript'
    s.text = INLINE_SCRIPT
    document.body.appendChild(s)
    return () => {
      const node = document.getElementById(scriptId)
      if (node) node.remove()
    }
  }, [])

  return (
    <div style={{ height: '100%', minHeight: 0, overflow: 'auto', background: '#090909', padding: 12, boxSizing: 'border-box' }}>
      <div dangerouslySetInnerHTML={{ __html: htmlBody }} />
    </div>
  )
}
