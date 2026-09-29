/**
 * GenUI gallery: canonical broad-coverage sample of built-in node types.
 * Docs, demos, and renderer tests reuse it as the component gallery fence.
 */
import type { GenuiSpec } from './spec.ts'

/** Canonical gallery spec for the built-in GenUI component vocabulary. */
export const gallerySpec: GenuiSpec = {
  title: 'GenUI · Component gallery',
  gap: 14,
  items: [
    { type: 'hero', label: 'Uptime · last 30 days', value: '99.96%', delta: '+0.02%', tone: 'accent', spark: [99.8, 99.85, 99.9, 99.88, 99.94, 99.96], title: 'hero cover block', subtitle: 'At most one per reply: eyebrow + oversized number + title + subtitle, with a tone gradient background.' },
    { type: 'grid', cols: 3, items: [
      { type: 'card', title: 'Default', items: [{ type: 'text', size: 'body', content: 'No accent: a neutral surface.' }] },
      { type: 'card', accent: '#f59e0b', title: 'accent #f59e0b', items: [{ type: 'text', size: 'body', content: 'Only the border and title carry the hue; the surface stays neutral.' }] },
      { type: 'card', accent: '#3ecf8e', title: 'accent #3ecf8e', items: [{ type: 'text', size: 'body', content: 'Stays clean under a dark theme.' }] },
    ] },
    { type: 'grid', cols: 3, items: [
      { type: 'card', span: 2, title: 'span:2 · wide card', items: [
        { type: 'text', size: 'body', content: 'Adding span to a grid child makes it cross columns: one wide card plus one narrow card. Row height follows the tallest card, and content stretches or centers to fill it.' },
        { type: 'chart', kind: 'line', data: [], series: [
          { label: 'This week', data: [{ label: 'Mon', value: 8 }, { label: 'Tue', value: 12 }, { label: 'Wed', value: 9 }, { label: 'Thu', value: 14 }] },
          { label: 'Last week', data: [{ label: 'Mon', value: 6 }, { label: 'Tue', value: 9 }, { label: 'Wed', value: 7 }, { label: 'Thu', value: 10 }] }] }] },
      { type: 'card', title: 'span:1', items: [{ type: 'chart', kind: 'donut', data: [{ label: 'Visual', value: 42 }, { label: 'Adoption', value: 33 }, { label: 'Reliability', value: 25 }] }] },
    ] },
    { type: 'text', size: 'h1', content: 'Typographic hierarchy' },
    { type: 'text', size: 'h2', content: 'Second-level heading' },
    { type: 'text', size: 'h3', content: 'Third-level heading' },
    { type: 'text', size: 'body', content: 'Body: components render from an allowlist, never through an arbitrary HTML path.' },
    { type: 'text', size: 'muted', content: 'Muted text' },
    { type: 'text', size: 'caption', content: 'Caption text', center: true },
    { type: 'row', items: [
      { type: 'badge', label: 'Success', tone: 'success' },
      { type: 'badge', label: 'Warning', tone: 'warn' },
      { type: 'badge', label: 'Danger', tone: 'danger' },
      { type: 'badge', label: 'Accent', tone: 'accent', icon: '★' },
      { type: 'avatar', name: 'Alice' },
      { type: 'avatar', name: 'Bob', color: '#3d9e8f' },
      { type: 'link', label: 'Details link' },
    ], wrap: true },
    { type: 'divider' },
    { type: 'image', src: '/demo-image.png', alt: 'Image display demo' },
    { type: 'audio', src: '/demo-audio.mp3', alt: 'Audio player demo' },
    { type: 'video', src: '/demo-video.mp4', alt: 'Video player demo', poster: '/demo-video.jpg', aspectRatio: '16:9' },
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: 'Online rate', value: '99.96%', size: 'hero', delta: '+0.02%' },
      { type: 'stat', label: 'CPU', value: '42%', delta: '+3.1%', spark: [31, 38, 35, 44, 40, 42] },
      { type: 'stat', label: 'Memory', value: '6.8 GB', delta: '-1.2%' },
      { type: 'stat', label: 'Requests', value: '128.4k', spark: [90, 104, 98, 121, 116, 128] },
    ] },
    { type: 'progress', label: 'Training progress', value: 72, valueLabel: '72%' },
    { type: 'progress', label: 'Coverage', value: 64, target: 80, valueLabel: '64% / target 80%' },
    { type: 'progress', variant: 'ring', value: 72, label: 'This round', valueLabel: 'Round 3 / 4' },
    { type: 'card', title: 'Performance metrics', items: [
      // Table headers sort on click with numeric awareness (thousands separators,
      // k, CJK scale units, and % all compare correctly), and numeric columns right-align.
      { type: 'table', columns: ['Metric', 'Q1', 'Q2', 'Q3'], rows: [
        ['Latency', 92, 87, 81], ['Throughput', '1.2k', '1.4k', '1.6k'], ['Error rate', '0.3%', '0.2%', '0.1%'],
        ['Revenue', '3.5\u4e07', '4.1\u4e07', '5.2\u4e07'], ['Signups', '1,234', '2,345', '3,456'],
      ] },
      { type: 'keyvalue', pairs: [
        { key: 'Version', value: 'v0.1.0' }, { key: 'Environment', value: 'production' }, { key: 'Region', value: 'cn-east' },
      ] },
    ] },
    { type: 'list', items: [
      { title: 'Titled item', desc: 'List item with a description' },
      'Plain-text list item',
      { title: 'Another title' },
    ] },
    { type: 'chart', kind: 'bars', data: [
      { label: 'One', value: 10 }, { label: 'Two', value: 20 }, { label: 'Three', value: 15 },
    ] },
    { type: 'chart', kind: 'line', data: [
      { label: 'Mon', value: 8 }, { label: 'Tue', value: 12 }, { label: 'Wed', value: 9 },
    ] },
    { type: 'chart', kind: 'donut', data: [
      { label: 'A', value: 30 }, { label: 'B', value: 70 },
    ] },
    { type: 'chart', data: [], series: [
      { label: 'This month', data: [{ label: 'Q1', value: 3 }, { label: 'Q2', value: 5 }] },
      { label: 'Last month', data: [{ label: 'Q1', value: 2 }, { label: 'Q2', value: 4 }] },
    ] },
    { type: 'chart', kind: 'line', data: [], series: [
      { label: 'This month', data: [{ label: 'One', value: 8 }, { label: 'Two', value: 12 }, { label: 'Three', value: 9 }] },
      { label: 'Last month', data: [{ label: 'One', value: 6 }, { label: 'Two', value: 9 }, { label: 'Three', value: 7 }] },
    ] },
    { type: 'chart', kind: 'bars', data: [], stacked: true, series: [
      { label: 'Done', data: [{ label: 'Q1', value: 42 }, { label: 'Q2', value: 58 }, { label: 'Q3', value: 61 }] },
      { label: 'In progress', data: [{ label: 'Q1', value: 18 }, { label: 'Q2', value: 14 }, { label: 'Q3', value: 9 }] },
    ] },
    { type: 'chart', horizontal: true, data: [
      { label: 'Organic search', value: 82 }, { label: 'Direct', value: 64 }, { label: 'Social', value: 41 },
    ] },
    { type: 'input', label: 'Filter services / status', placeholder: 'Type a keyword to filter the table below', id: 'gallery-filter' },
    { type: 'table', columns: ['Service', 'P95', 'Status'], types: ['text', 'num', 'badge'], filter: 'gallery-filter', rows: [
      ['API gateway', '128', 'OK'],
      ['Search', '190', 'Watch'],
      ['Recommend', '250', 'High'],
    ] },
    { type: 'table', columns: ['Service', 'P95', 'Status'], types: ['text', 'num', 'badge'], details: [
      [{ type: 'keyvalue', pairs: [{ key: 'Owner', value: 'Platform team' }, { key: 'SLO', value: 'P95 < 150ms' }] },
       { type: 'text', size: 'body', content: 'An expanded row can hold any component: metrics, charts, lists, or forms.' }],
      null,
      [{ type: 'progress', value: 91, target: 80, label: 'Load level', valueLabel: '91% / target 80%' }],
    ], rows: [
      ['API gateway', '128', 'OK'],
      ['Search', '190', 'Watch'],
      ['Recommend', '250', 'High'],
    ] },
    { type: 'table', columns: ['Region', 'Q1', 'Q2', 'Q3'], types: ['group', 'num', 'num', 'num'], total: true, rows: [
      ['East China', '', '', ''],
      ['Shanghai', '120', '138', '151'],
      ['Hangzhou', '96', '104', '118'],
      ['North China', '', '', ''],
      ['Beijing', '88', '95', '103'],
    ] },
    { type: 'card', tone: 'success', title: 'Passed', items: [
      { type: 'text', size: 'body', content: 'Grouped table: when the first column is a group, a row whose first cell has content renders as a full-width subheading; total appends a totals row.' },
    ] },
    { type: 'table', columns: ['#', 'Service', 'Latency, last 6 periods', 'Uptime', 'Load', 'Status'], types: ['index', 'text', 'spark', 'ring', 'bar', 'badge'], rows: [
      ['1', 'API gateway', '180,164,150,140,133,128', '99.96', '62', 'OK'],
      ['2', 'Search', '220,210,230,205,198,190', '99.82', '78', 'Watch'],
      ['3', 'Recommend', '310,340,300,280,260,250', '99.41', '91', 'High'],
    ] },
    { type: 'table', columns: ['Channel', 'Completion', 'Status'], types: ['text', 'bar', 'badge'], rows: [
      ['Organic search', '82', 'Healthy'], ['Direct', '64', 'Watch'], ['Social', '41', 'Low'],
    ] },
    { type: 'tabs', tabs: [
      { label: 'Overview', items: [{ type: 'text', content: 'Content of tab one' }] },
      { label: 'Details', items: [{ type: 'list', items: ['Detail A', 'Detail B'] }] },
      { label: 'Charts', items: [{ type: 'chart', kind: 'donut', data: [{ label: 'X', value: 40 }, { label: 'Y', value: 60 }] }] },
    ] },
    { type: 'col', gap: 8, items: [
      { type: 'button', label: 'Primary button', tone: 'primary' },
      { type: 'button', label: 'Danger', tone: 'danger', small: true },
      { type: 'button', label: 'Success', tone: 'success' },
      { type: 'button', label: 'Ghost', tone: 'ghost', icon: '↗' },
    ] },
    { type: 'row', items: [
      { type: 'input', label: 'Name', placeholder: 'Type…' },
      { type: 'select', label: 'Environment', options: ['dev', 'staging', 'production'] },
    ], wrap: true },
    { type: 'row', items: [
      { type: 'checkbox', label: 'Auto-save', checked: true },
      { type: 'switch', label: 'Notifications', checked: true },
      { type: 'radio', label: 'Theme', options: ['Light', 'Dark', 'System'] },
    ], wrap: true },
    { type: 'textarea', label: 'Notes', placeholder: 'Multi-line input…', rows: 3 },
    { type: 'accordion', items: [
      { title: 'First item', items: [{ type: 'json', value: { ok: true, count: 3 } }] },
      { title: 'Second item', items: [{ type: 'code', lang: 'ts', code: 'export const x = 1' }] },
    ] },
    { type: 'copy', label: 'Copy token', text: 'sk-1234567890' },
    { type: 'echart', preset: 'bar', title: 'echart · preset:bar (downloads the core engine only)', height: 240, data: [
      { label: 'Organic search', value: 82 }, { label: 'Direct', value: 64 }, { label: 'Social', value: 41 },
    ] },
    { type: 'echart', preset: 'radar', title: 'echart · preset:radar (pulls the full engine on demand)', height: 280, series: [
      { label: 'This round', data: [{ label: 'Visual', value: 86 }, { label: 'Usable', value: 92 }, { label: 'Performance', value: 74 }, { label: 'Adoption', value: 88 }, { label: 'Stability', value: 90 }] },
      { label: 'Last round', data: [{ label: 'Visual', value: 62 }, { label: 'Usable', value: 70 }, { label: 'Performance', value: 58 }, { label: 'Adoption', value: 61 }, { label: 'Stability', value: 72 }] },
    ] },
    { type: 'echart', preset: 'sankey', title: 'echart · preset:sankey (driven by links)', height: 260, links: [
      { from: 'Entry', to: 'API', value: 40 },
      { from: 'Entry', to: 'Cache', value: 25 },
      { from: 'API', to: 'Render', value: 32 },
      { from: 'Render', to: 'Done', value: 30 },
      { from: 'Cache', to: 'Done', value: 28 },
    ] },
    { type: 'echart', preset: 'wordCloud', title: 'echart · preset:wordCloud (word cloud, full engine + extension)', height: 240, data: [
      { label: 'System', value: 90 }, { label: 'User', value: 70 }, { label: 'Permissions', value: 60 },
      { label: 'Modules', value: 50 }, { label: 'Data', value: 45 }, { label: 'Security', value: 40 },
      { label: 'Extension', value: 30 }, { label: 'Render', value: 25 },
    ] },
    { type: 'svg', title: 'svg · standalone image preview (isolated rendering)', height: 160, code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 120"><rect width="220" height="120" rx="10" fill="#534ab7"/><rect x="16" y="16" width="88" height="40" rx="6" fill="#7f74f2"/><text x="60" y="42" text-anchor="middle" fill="#fff" font-size="13">gateway</text><rect x="116" y="64" width="88" height="40" rx="6" fill="#3ecf8e"/><text x="160" y="90" text-anchor="middle" fill="#fff" font-size="13">service</text><path d="M104 56 L116 76" stroke="#fff" stroke-width="2"/></svg>' },
    { type: 'plot', title: 'Superimposed waves', xMin: -6.28, xMax: 6.28, series: [
      { expr: 'sin(x)', label: 'sin(x)', color: '#4f8ef7' },
      { expr: '0.8*cos(x)', label: 'cos', color: '#3ecf8e' },
    ] },
    { type: 'callout', tone: 'info', title: 'Note', content: 'The gallery covers the full component vocabulary.' },
    { type: 'steps', current: 2, steps: [
      { title: 'Draft', desc: 'Write the spec' }, { title: 'Render', desc: 'Draw components' }, { title: 'Verify', desc: 'Run tests' },
    ] },
    { type: 'diff', diffs: [
      { path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' },
    ] },
    { type: 'code', lang: 'json', code: '{"hello": "world"}' },
    { type: 'mermaid', code: 'graph TD\nA[Model] --> B[Renderer]\nB --> C[Components]' },
    { type: 'diagram', kind: 'architecture', title: 'Architecture diagram (colors follow host tokens)', nodes: [
      { id: 'm', label: 'Model', type: 'external', x: 20, y: 40, w: 100, h: 44 },
      { id: 'f', label: 'Fence JSON', type: 'focal', x: 160, y: 40, w: 112, h: 44 },
      { id: 'g', label: 'guard', type: 'backend', x: 312, y: 40, w: 104, h: 44 },
      { id: 's', label: 'Component library', type: 'store', x: 456, y: 40, w: 100, h: 44 },
    ], edges: [{ from: 'm', to: 'f' }, { from: 'f', to: 'g' }, { from: 'g', to: 's' }] },
    { type: 'scene3d', title: 'Geometry demo', ambient: 1, meshes: [
      { shape: 'box', color: '#4f8ef7', position: [-1.4, 0, 0], rotation: [0.5, 0.8, 0] },
      { shape: 'sphere', color: '#3ecf8e', position: [0, 0, 0] },
      { shape: 'cone', color: '#e0a458', position: [1.4, 0, 0] },
    ] },
    { type: 'timeline', items: [
      { title: 'Released v0.1', desc: 'First usable version', time: '08-01' },
      { title: 'Event loop', desc: 'Actions flow back', time: '08-08' },
    ] },
    { type: 'file-tree', items: [
      { name: 'src', type: 'dir', children: [
        { name: 'client', type: 'dir', children: [{ name: 'GenuiBlock.tsx', type: 'file' }] },
        { name: 'spec.ts', type: 'file' },
      ] },
      { name: 'README.md', type: 'file' },
    ] },
    { type: 'breadcrumb', items: ['Home', 'Components', 'Gallery'] },
    { type: 'quiz', question: '1 + 1 = ?', id: 'gallery-q1', options: [
      { label: '1', feedback: 'Think again' }, { label: '2', correct: true }, { label: '3' },
    ], explanation: 'In binary 1+1=10; in decimal it is 2.' },
    { type: 'spacer' },
  ],
}
