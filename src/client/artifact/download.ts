import { GenuiExportError, type GenuiArtifactV1 } from './types.ts'
import { serializeGenuiArtifact } from './json.ts'
import { buildStandaloneHtml } from './html.ts'

/** Strip path separators, control characters, and unsafe punctuation from a filename. */
export function sanitizeArtifactFilename(title: string | undefined, extension: '.html' | '.genui.json'): string {
  const base = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 120).replace(/[. ]+$/g, '')
  return `${base || 'genui'}${extension}`
}

/** Trigger a browser download and release the temporary URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Download the normalized GenUI JSON artifact. */
export function downloadGenuiArtifactJson(artifact: GenuiArtifactV1): void {
  try {
    downloadBlob(new Blob([serializeGenuiArtifact(artifact)], { type: 'application/json;charset=utf-8' }), sanitizeArtifactFilename(artifact.spec.title, '.genui.json'))
  } catch (error) {
    throw new GenuiExportError('download-failed', error instanceof Error ? error.message : 'artifact download failed')
  }
}

/** Build and download the standalone HTML. */
export async function downloadGenuiArtifactHtml(artifact: GenuiArtifactV1): Promise<void> {
  try {
    const html = await buildStandaloneHtml(artifact)
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), sanitizeArtifactFilename(artifact.spec.title, '.html'))
  } catch (error) {
    if (error instanceof GenuiExportError) throw error
    throw new GenuiExportError('download-failed', error instanceof Error ? error.message : 'artifact download failed')
  }
}
