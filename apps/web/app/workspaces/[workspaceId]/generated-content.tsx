export function GeneratedContent({ text, fields, kind }: {
  text: string
  fields?: Record<string, string>
  kind?: string
}) {
  if (fields && kind === 'quiz') {
    return <>
      <p>{fields.question}</p>
      <p className="source-excerpt">{fields.options}</p>
      <details><summary>Show answer</summary><p>{fields.answer}</p></details>
    </>
  }
  if (fields && kind === 'flashcards') {
    return <details><summary>{fields.front}</summary><p>{fields.back}</p></details>
  }
  if (fields && kind === 'mind_map') {
    return <ul><li>{fields.parent}<ul><li>{fields.child} · {fields.relationship}</li></ul></li></ul>
  }
  return <>
    <p className="source-excerpt">{text}</p>
    {fields && !!Object.keys(fields).length && <dl>{
      Object.entries(fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)
    }</dl>}
  </>
}
