'use client'
import { useId, useState } from 'react'
import type { CitationTarget } from './pdf-preview'
import { useWorkspaceLanguage } from '../../components/workspace-language'

type Citation = CitationTarget & { name: string; chunk_id: string }
export type ConceptGraph = { nodes: { id: string; label: string; citations: Citation[] }[]; edges: { id: string; source: string; target: string; label: string }[] }
export function ConceptMap({ graph, onCitation }: { graph: ConceptGraph; onCitation: (citation: Citation) => void }) {
  const { text } = useWorkspaceLanguage()
  const [selected, setSelected] = useState<string>()
  const marker = useId().replaceAll(':', '')
  const nodes = graph.nodes.slice(0, 200)
  const positions = new Map(nodes.map((node, index) => [node.id, { x: 20 + index % 3 * 290, y: 20 + Math.floor(index / 3) * 170 }]))
  const active = nodes.find(node => node.id === selected)
  function activate(node: typeof nodes[number]) {
    setSelected(node.id)
    if (node.citations.length === 1) onCitation(node.citations[0])
  }
  if (!nodes.length) return <p>{text('No concept relationships are available in this artifact.', 'Artifact chưa có quan hệ khái niệm.')}</p>
  return <section className="form-stack" aria-label={text('Concept map', 'Bản đồ khái niệm')}>
    <p>{text('Choose a concept to inspect its source pages. Use Tab and Enter to navigate.', 'Chọn khái niệm để xem trang nguồn. Dùng Tab và Enter để điều hướng.')}</p>
    <div className="table-scroll" tabIndex={0}>
      <svg width="890" height={Math.ceil(nodes.length / 3) * 170 + 20} role="group" aria-label={text('Concept relationships', 'Quan hệ khái niệm')}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>
        {graph.edges.map(edge => {
          const from = positions.get(edge.source), to = positions.get(edge.target)
          if (!from || !to) return null
          const self = edge.source === edge.target
          const d = self ? `M${from.x + 190},${from.y + 80} c90,-80 -90,-80 0,0` : `M${from.x + 125},${from.y + 110} L${to.x + 125},${to.y + 5}`
          return <g key={edge.id}><title>{edge.label}</title><path d={d} fill="none" stroke="currentColor" opacity=".45" markerEnd={`url(#${marker})`} />
            <text x={self ? from.x + 210 : (from.x + to.x) / 2 + 130} y={self ? from.y + 30 : (from.y + to.y) / 2 + 65} fontSize="11" fill="currentColor">{edge.label.slice(0, 38)}</text></g>
        })}
        {nodes.map(node => {
          const point = positions.get(node.id)!
          const words = node.label.match(/.{1,27}(?:\s|$)|.{1,27}/gu) ?? [node.label]
          return <g key={node.id} transform={`translate(${point.x},${point.y})`} role="button" tabIndex={0}
            aria-label={node.label} aria-pressed={selected === node.id} onClick={() => activate(node)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(node) } }} style={{ cursor: 'pointer' }}>
            <title>{node.label}</title><rect width="250" height="110" rx="10" fill="var(--surface-subtle)" stroke="currentColor" strokeWidth={selected === node.id ? 3 : 1} />
            <text x="12" y="26" fill="currentColor" fontSize="14">{words.slice(0, 3).map((line, index) => <tspan key={index} x="12" dy={index ? 20 : 0}>{line}{index === 2 && words.length > 3 ? '…' : ''}</tspan>)}</text>
            <text x="12" y="98" fontSize="11" fill="currentColor">{node.citations.length} {text('sources', 'nguồn')}</text>
          </g>
        })}
      </svg>
    </div>
    {active && <div role="group" aria-label={text('Concept sources', 'Nguồn khái niệm')}><strong>{active.label}</strong>
      {active.citations.length ? active.citations.map(citation => <button type="button" className="citation-pill" key={(citation.citation_id ?? citation.chunk_id) + ':' + citation.page}
        onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>) : <p>{text('No source is linked to this concept.', 'Khái niệm chưa có liên kết nguồn.')}</p>}
    </div>}
  </section>
}
