import type { Presentation } from '../../types/presentation';
import { createPptxArchive } from './pptx-exporter';

const pptxMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function downloadPptx(presentation: Presentation): string {
  const archive = createPptxArchive(presentation);
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);

  const filename = `${presentation.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.pptx`;
  const objectUrl = URL.createObjectURL(new Blob([archiveBuffer], { type: pptxMimeType }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return filename;
}
