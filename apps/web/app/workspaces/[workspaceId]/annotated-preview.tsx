'use client'
import { DesignIcon } from '../../components/aipollo'
import { PdfPreview, type CitationTarget } from './pdf-preview'
export function AnnotatedPreview({
  documentUrl,
  page,
  citation,
  onPage,
  onClearCitation,
  onPendingChange,
  onDirtyChange,
}: {
  documentUrl: string
  page: number
  citation?: CitationTarget
  onPage: (page: number) => void
  onClearCitation: () => void
  onPendingChange?: (pending: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  return (
    <>
      <PdfPreview
        url={documentUrl + '/preview'}
        annotationsUrl={documentUrl + '/annotations'}
        page={page}
        onPage={onPage}
        citationRegion={citation?.region ?? undefined}
        citationRegions={citation?.regions}
        onClearCitation={onClearCitation}
        onPendingChange={onPendingChange}
        onDirtyChange={onDirtyChange}
      />
      {citation?.text && (
        <section className="reader-annotations form-stack" aria-label="Selected evidence">
          <h3>
            <DesignIcon name="annotate" /> Source evidence · p. {citation.page}
          </h3>
          <p className="muted">{citation.text}</p>
        </section>
      )}
    </>
  )
}
